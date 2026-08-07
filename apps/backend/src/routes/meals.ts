import type { Meal, MealResponse, MealSlot, MealSlotsResponse, MealsResponse } from '@sage-burner/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import {
  apiRoutes,
  helperSchema,
  mealCreateSchema,
  mealIdeaUpdateSchema,
  mealIntroUpdateSchema,
  mealLeadSchema,
  mealSlotCreateSchema,
  mealSlotUpdateSchema,
  mealUpdateSchema,
} from '@sage-burner/shared'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'
import type { Notifier } from '../push/notify.ts'

import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { isForeignKeyViolation, isUniqueViolation } from '../db/errors.ts'
import { account, attendance, event, meal, mealRole, mealSlot } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { refuseIfStale, withVersion } from '../if-match.ts'
import { accountForAttendance, attendanceFor } from './attendance.ts'
import { openEventNow } from './events.ts'

export interface MealDeps extends GuardDeps {
  now: () => Date
  /** Told when somebody is put on a crew, or taken off one, by anybody but themselves. */
  notify?: Notifier
}

type Person = NonNullable<Meal['lead']>
type MealRow = typeof meal.$inferSelect
type Burn = typeof event.$inferSelect

/** What deciding a sitting's days actually needs — not the whole burn. */
type BurnSpan = Pick<Burn, 'end_date' | 'end_time' | 'start_date' | 'start_time'>

/** The two roles anybody may put themselves on. The lead is one person, elsewhere. */
const STANDING = ['helper', 'cleanup'] as const

/**
 * Every date a sitting at `at` belongs on.
 *
 * The burn's own hours decide it, not its dates: a 13:00 lunch on a day the gates
 * open at 16:00 is not a meal anyone eats, and the last day ends when it ends — which
 * is why the spreadsheet's plan starts at a Sunday dinner and ends at a Sunday lunch.
 *
 * Both comparisons are on fixed-width strings, sound for the reason the CHECKs rely
 * on: `09:00` cannot also arrive as `9:00`.
 */
export const sittingDates = (burn: BurnSpan, at: string): string[] => {
  const dates: string[] = []
  const day = new Date(`${burn.start_date}T00:00:00Z`)
  const last = new Date(`${burn.end_date}T00:00:00Z`)
  if (Number.isNaN(day.getTime()) || Number.isNaN(last.getTime())) return dates

  while (day <= last) {
    const date = day.toISOString().slice(0, 10)
    const tooEarly = date === burn.start_date && at < burn.start_time
    const tooLate = date === burn.end_date && at > burn.end_time
    if (!tooEarly && !tooLate) dates.push(date)
    day.setUTCDate(day.getUTCDate() + 1)
  }

  return dates
}

const slotsFor = (db: Database, eventId: string): Promise<MealSlot[]> =>
  db
    .select()
    .from(mealSlot)
    .where(eq(mealSlot.event_id, eventId))
    .orderBy(asc(mealSlot.at), asc(mealSlot.order), asc(mealSlot.id))

/**
 * A burn's meals in the order the table shows them, with everyone signed up.
 *
 * One query for every role on every meal rather than one per row: a burn is a handful
 * of days and a handful of sittings, and the page reads the lot at once. `rolesFor` in
 * the lead-roles register is shaped the same way.
 */
const mealsFor = async (db: Database, eventId: string): Promise<Meal[]> => {
  const rows = await db
    .select()
    .from(meal)
    .where(eq(meal.event_id, eventId))
    .orderBy(asc(meal.date), asc(meal.at), asc(meal.label))

  if (rows.length === 0) return []

  const signups = await db
    .select({ meal_id: mealRole.meal_id, role: mealRole.role, account_id: account.id, name: account.name })
    .from(mealRole)
    .innerJoin(attendance, eq(attendance.id, mealRole.attendance_id))
    .innerJoin(account, eq(account.id, attendance.account_id))
    .where(
      inArray(
        mealRole.meal_id,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(account.name), asc(account.id))

  const lead = new Map<string, Person>()
  const helpers = new Map<string, Person[]>()
  const cleanup = new Map<string, Person[]>()

  for (const row of signups) {
    const person = { account_id: row.account_id, name: row.name }
    if (row.role === 'lead') lead.set(row.meal_id, person)
    if (row.role === 'helper') helpers.set(row.meal_id, [...(helpers.get(row.meal_id) ?? []), person])
    if (row.role === 'cleanup') cleanup.set(row.meal_id, [...(cleanup.get(row.meal_id) ?? []), person])
  }

  // Field by field rather than a spread, like `asMemberEntry`: a spread is exempt from
  // excess-property checking, so a column added to `meal` would reach every reader
  // without anybody naming it here.
  return rows.map((row) => ({
    id: row.id,
    event_id: row.event_id,
    date: row.date,
    at: row.at,
    label: row.label,
    kind: row.kind,
    food_idea: row.food_idea,
    lead: lead.get(row.id) ?? null,
    helpers: helpers.get(row.id) ?? [],
    cleanup: cleanup.get(row.id) ?? [],
  }))
}

const oneMeal = async (db: Database, id: string) => {
  const [row] = await db.select({ event_id: meal.event_id }).from(meal).where(eq(meal.id, id)).limit(1)
  if (row === undefined) return undefined

  return (await mealsFor(db, row.event_id)).find((found) => found.id === id)
}

const burnFor = async (db: Database, eventId: string) => {
  const [row] = await db.select().from(event).where(eq(event.id, eventId)).limit(1)
  return row
}

/**
 * Meals — who cooks, who helps and who washes up.
 *
 * `requireApproved` throughout, including the removals: this replaces a tab of a
 * spreadsheet everyone could edit, and the lead-roles register made the same call for
 * the same reason. What stays admin's is the plan itself — the slots, and adding,
 * moving or dropping a sitting — which is why those live under `/api/admin/`.
 */
export const registerMealRoutes = (
  app: FastifyInstance,
  { db, sessions, now, notify = async () => undefined }: MealDeps,
) => {
  const { requireApproved } = createGuards({ db, sessions })

  /** Tell somebody, unless they did it themselves. Same rule as the register. */
  const tell = async (by: string, accountId: string, message: string) => {
    if (accountId === by) return

    await notify(accountId, { category: 'meal_role', body: message, link: '/meals' })
  }

  /**
   * The sitting, if its burn has not ended.
   *
   * Every write below is keyed by a bare meal id, so the burn is resolved from the
   * row — `openEvent`, not `activeEvent`, because a plan is laid months ahead. A
   * finished burn's meals are its record: readable, and not something an id noted
   * while it was current should still be a way to rewrite.
   *
   * Without this a dream in a past burn could not be moved while the meal block
   * beside it on the same grid could, and anybody could rewrite who cooked last
   * summer.
   */
  const openMeal = async (id: string): Promise<MealRow | undefined> => {
    const [row] = await db.select().from(meal).where(eq(meal.id, id)).limit(1)
    if (row === undefined) return undefined

    return (await openEventNow(db, now, row.event_id)) === undefined ? undefined : row
  }

  /**
   * The whole meal plan, as both the `GET` and the `If-Match` guards see it (#274).
   *
   * The intro text is part of it, so rewriting the words above the table is guarded
   * by the same tag as moving a sitting — which is right: they are one page.
   */
  const plan = async (eventId: string): Promise<MealsResponse> => {
    const burn = await burnFor(db, eventId)

    return {
      // The burn is there — every caller has already 404'd without it. `??` is for
      // the guard's re-read racing a deletion, where an empty plan simply will not
      // match and the write is refused, which is the right answer anyway.
      intro_markdown: burn?.meal_intro_markdown ?? '',
      slots: await slotsFor(db, eventId),
      meals: await mealsFor(db, eventId),
    }
  }

  const answer = async (reply: FastifyReply, id: string) => {
    const found = await oneMeal(db, id)

    return found === undefined ? sendError(reply, 404) : ({ meal: found } satisfies MealResponse)
  }

  app.get<{ Params: { eventId: string } }>(
    apiRoutes.getMeals.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const burn = await burnFor(db, request.params.eventId)
      if (burn === undefined) return sendError(reply, 404)

      return withVersion(reply, await plan(burn.id))
    },
  )

  /** The words above the table. Any approved member, like the burn's welcome text. */
  app.patch<{ Params: { eventId: string } }>(
    apiRoutes.updateMealIntro.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(mealIntroUpdateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      // Scoped like the writes below, and unlike `/events/:id/welcome`, which has the
      // same gap — see #218. New code follows the rule rather than the neighbour.
      if ((await openEventNow(db, now, request.params.eventId)) === undefined) {
        return sendError(reply, 404)
      }

      if (await refuseIfStale(request, reply, () => plan(request.params.eventId))) return reply

      const [row] = await db
        .update(event)
        .set({ meal_intro_markdown: body.meal_intro_markdown })
        .where(eq(event.id, request.params.eventId))
        .returning({ intro: event.meal_intro_markdown })

      return row === undefined ? sendError(reply, 404) : { meal_intro_markdown: row.intro }
    },
  )

  /**
   * Taking a meal's lead, handing it to somebody, or vacating it.
   *
   * One route for all three, like the lead-roles register: they differ only in whose
   * id is in the body, and `null` vacates.
   *
   * The delete and the insert are one synchronous transaction, so `meal_role_lead_idx`
   * is never the thing a caller has to work around. Awaited separately (#214) there
   * was a window between them, and a second request arriving inside it would insert a
   * lead the first had not yet replaced.
   *
   * Untested, and stated as a window rather than an observation: six concurrent
   * handovers through `inject` do not reproduce it, so a test asserting the fix would
   * pass against the code it exists to reject. The transaction closes the window at
   * no cost; that is the whole of the claim.
   */
  app.put<{ Params: { id: string } }>(
    apiRoutes.setMealLead.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(mealLeadSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const existing = await openMeal(request.params.id)
      if (existing === undefined) return sendError(reply, 404)

      // A chore has nobody cooking, so it has nobody leading the cooking. Refused
      // rather than only hidden: the page not offering it is not the rule.
      //
      // Vacating stays allowed, like standing down from the crew below: a sitting
      // changed to a chore under whoever was leading it must not strand them there
      // with no way off.
      if (existing.kind === 'chore' && body.account_id !== null) {
        return sendError(reply, 400)
      }

      let taking: string | undefined
      if (body.account_id !== null) {
        taking = await attendanceFor(db, existing.event_id, body.account_id)

        // Not coming to this burn. A 400 rather than a 404: the account may well
        // exist, and what is wrong is the pairing.
        if (taking === undefined) return sendError(reply, 400)
      }

      // Whoever holds it now, read before the write takes it off them.
      const [current] = await db
        .select({ attendance_id: mealRole.attendance_id })
        .from(mealRole)
        .where(and(eq(mealRole.meal_id, existing.id), eq(mealRole.role, 'lead')))
        .limit(1)

      const held = current === undefined ? undefined : await accountForAttendance(db, current.attendance_id)

      const handedTo = taking
      db.transaction((tx) => {
        tx.delete(mealRole)
          .where(and(eq(mealRole.meal_id, existing.id), eq(mealRole.role, 'lead')))
          .run()

        if (handedTo !== undefined) {
          tx.insert(mealRole).values({ meal_id: existing.id, attendance_id: handedTo, role: 'lead' }).run()
        }
      })

      // Both ends, since one write can move the lead off one person and onto
      // another — and vacating is how every handover starts now, so being taken off
      // has to be told as well as being given it.
      const viewer = await viewerFor(request, { db, sessions })
      const by = viewer?.account_id ?? ''

      if (held !== undefined && held !== body.account_id) {
        await tell(by, held, `You are no longer leading ${existing.label}`)
      }
      if (body.account_id !== null && body.account_id !== held) {
        await tell(by, body.account_id, `You are leading ${existing.label}`)
      }

      return answer(reply, existing.id)
    },
  )

  /**
   * Putting yourself on a meal's helpers or its cleanup crew, and taking yourself off.
   *
   * One handler for both verbs — they differ by an insert against a delete, and
   * splitting them would be the same resolution written twice.
   */
  const stand =
    (joining: boolean) =>
    async (
      request: FastifyRequest<{ Params: { id: string; role: string; accountId?: string } }>,
      reply: FastifyReply,
    ) => {
      void noStore(reply)

      // Matched against the vocabulary rather than compared away from it: excluding
      // two literals from `string` narrows nothing, so the row would go in with
      // `role: string`. The lead has its own route, where handing it over is a thing
      // you may do to somebody else.
      const role = STANDING.find((candidate) => candidate === request.params.role)
      if (role === undefined) return sendError(reply, 404)

      const existing = await openMeal(request.params.id)
      if (existing === undefined) return sendError(reply, 404)

      // Nothing is cooked at a chore, so there is nothing to help cook. Standing down
      // stays allowed whatever the kind, or a slot changed to a chore would strand
      // whoever had already put their name to it.
      if (existing.kind === 'chore' && role === 'helper' && joining) {
        return sendError(reply, 400)
      }

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      const accountId = whoseHands(joining, request)
      if (accountId === undefined) return sendError(reply, 400)

      const mine = await attendanceFor(db, existing.event_id, accountId)
      if (mine === undefined) return sendError(reply, 400)

      const row = { meal_id: existing.id, attendance_id: mine, role }

      if (joining) {
        // Standing twice is standing once, which is what a double click sends — and
        // `.returning()` is what tells the two apart, so the second click does not
        // push somebody a duplicate.
        const added = await db.insert(mealRole).values(row).onConflictDoNothing().returning()

        if (added.length > 0) {
          await tell(viewer.account_id, accountId, `You are on ${role} for ${existing.label}`)
        }
      } else {
        const gone = await db
          .delete(mealRole)
          .where(
            and(
              eq(mealRole.meal_id, row.meal_id),
              eq(mealRole.attendance_id, row.attendance_id),
              eq(mealRole.role, role),
            ),
          )
          .returning()

        // Only when a row actually went, like both siblings: taking somebody off a
        // crew they were never on would tell them they had been dropped from it.
        if (gone.length > 0) {
          await tell(viewer.account_id, accountId, `You are off ${role} for ${existing.label}`)
        }
      }

      return answer(reply, existing.id)
    }

  app.put<{ Params: { id: string; role: string } }>(
    apiRoutes.joinMealCrew.fastify,
    { preHandler: requireApproved },
    stand(true),
  )
  app.delete<{ Params: { id: string; role: string; accountId: string } }>(
    apiRoutes.leaveMealCrew.fastify,
    { preHandler: requireApproved },
    stand(false),
  )

  /**
   * Moving a sitting, renaming it, or putting it on another day.
   *
   * `requireApproved`, unlike adding or dropping one. The schedule is the members'
   * to arrange — that is what #20 settled — and a meal you can see in the grid but
   * not nudge would be the one block on it that nobody could touch. Adding and
   * dropping stay admin's, because those change whether people get fed.
   */
  app.patch<{ Params: { id: string } }>(
    apiRoutes.updateMeal.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(mealUpdateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const existing = await openMeal(request.params.id)
      if (existing === undefined) return sendError(reply, 404)

      // A sitting the burn does not cover disappears from the schedule, whose rows
      // span the burn's own hours, while still showing on the Meals page — two views
      // disagreeing about whether it exists. Dreams may sit outside the grid because
      // the pool holds whatever it does not draw; meals have no pool.
      if (body.date !== undefined) {
        const burn = await burnFor(db, existing.event_id)
        if (burn === undefined) return sendError(reply, 404)
        if (body.date < burn.start_date || body.date > burn.end_date) {
          return sendError(reply, 400)
        }
      }

      if (Object.keys(body).length > 0) {
        if (await refuseIfStale(request, reply, () => plan(existing.event_id))) return reply

        try {
          await db.update(meal).set(body).where(eq(meal.id, request.params.id))
        } catch (failure) {
          // Onto a day that already has one by that name, which the unique index
          // refuses. A 409: the body is well formed and the burn already has one.
          // Anything else is ours, and saying "there is already one of those" about a
          // database that fell over would send the caller after the wrong thing.
          if (!isUniqueViolation(failure)) throw failure

          return sendError(reply, 409)
        }
      }

      return answer(reply, request.params.id)
    },
  )

  /**
   * What somebody thought of cooking. Anyone may write it, and the lead is not bound
   * by it — the sheet's own header called the column "Not needed".
   */
  app.put<{ Params: { id: string } }>(
    apiRoutes.setMealIdea.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(mealIdeaUpdateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const existing = await openMeal(request.params.id)
      if (existing === undefined) return sendError(reply, 404)

      if (await refuseIfStale(request, reply, () => plan(existing.event_id))) return reply

      await db.update(meal).set({ food_idea: body.food_idea.trim() }).where(eq(meal.id, existing.id))

      return answer(reply, existing.id)
    },
  )
}

/**
 * Whose hands: the body when joining, the path when standing down. Both name a person
 * rather than meaning the caller (#247) — 🙋 sends the caller's own id.
 */
const whoseHands = (
  joining: boolean,
  request: FastifyRequest<{ Params: { id: string; role: string; accountId?: string } }>,
): string | undefined => {
  if (!joining) return request.params.accountId

  return bodyOf(helperSchema, request)?.account_id
}

/**
 * The plan itself — the slot templates, and adding, moving or dropping a sitting.
 *
 * Under `/api/admin/`, which one `onRequest` hook guards with no per-route opt-out.
 * Opening any of these would mean moving it out from under the prefix, never
 * exempting it here.
 */

export const registerMealAdminRoutes = (app: FastifyInstance, { db }: MealDeps) => {
  const answerSlots = async (eventId: string): Promise<MealSlotsResponse> => ({
    slots: await slotsFor(db, eventId),
  })

  app.get<{ Params: { eventId: string } }>(apiRoutes.getMealSlots.fastify, async (request, reply) => {
    void noStore(reply)

    // Looked up rather than selected straight by `event_id`, which answered
    // `200 {slots: []}` for any id at all — including one that had never existed.
    // Its siblings 404, and whoever reads one route to learn how the others behave
    // should not be told something different by each.
    const burn = await burnFor(db, request.params.eventId)
    if (burn === undefined) return sendError(reply, 404)

    return answerSlots(burn.id)
  })

  app.post<{ Params: { eventId: string } }>(apiRoutes.addMealSlot.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(mealSlotCreateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const existing = await slotsFor(db, request.params.eventId)
    const order = existing.reduce((highest, slot) => Math.max(highest, slot.order + 1), 0)

    try {
      await db.insert(mealSlot).values({ ...body, id: randomUUID(), event_id: request.params.eventId, order })
    } catch (failure) {
      if (isForeignKeyViolation(failure)) return sendError(reply, 404)
      throw failure
    }

    return reply.code(201).send(await answerSlots(request.params.eventId))
  })

  app.patch<{ Params: { id: string } }>(apiRoutes.updateMealSlot.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(mealSlotUpdateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const [existing] = await db.select().from(mealSlot).where(eq(mealSlot.id, request.params.id)).limit(1)
    if (existing === undefined) return sendError(reply, 404)

    // `set({})` is not valid SQL, so an empty body reads instead of writing.
    if (Object.keys(body).length > 0) {
      await db.update(mealSlot).set(body).where(eq(mealSlot.id, request.params.id))
    }

    // The meals already generated are left alone. A slot is a template, and a rename
    // that reached back through everything it had made would undo whatever an
    // admin had since changed by hand.
    return answerSlots(existing.event_id)
  })

  app.delete<{ Params: { id: string } }>(apiRoutes.deleteMealSlot.fastify, async (request, reply) => {
    void noStore(reply)

    const [row] = await db
      .delete(mealSlot)
      .where(eq(mealSlot.id, request.params.id))
      .returning({ event_id: mealSlot.event_id })

    // The meals it made stay, for the same reason a rename does not reach them.
    return row === undefined ? sendError(reply, 404) : reply.code(204).send()
  })

  /**
   * Fill the burn's days in from its slots.
   *
   * **Adds what is missing and touches nothing else**, so it is safe to run again
   * after adding a slot or extending the dates. Never deletes: a meal somebody has
   * already signed up to cook is not something a button should be able to take away.
   *
   * A sitting already exists when the burn has one that day with that name. Moving
   * Saturday's dinner to 19:00 therefore survives regenerating, which is the whole
   * reason meals are rows.
   */
  app.post<{ Params: { eventId: string } }>(apiRoutes.generateMeals.fastify, async (request, reply) => {
    void noStore(reply)

    const burn = await burnFor(db, request.params.eventId)
    if (burn === undefined) return sendError(reply, 404)

    const slots = await slotsFor(db, burn.id)
    const existing = await db
      .select({ date: meal.date, label: meal.label })
      .from(meal)
      .where(eq(meal.event_id, burn.id))

    const already = new Set(existing.map((row) => `${row.date} ${row.label}`))

    const wanted = slots.flatMap((slot) =>
      sittingDates(burn, slot.at)
        .filter((date) => !already.has(`${date} ${slot.label}`))
        .map((date) => ({
          id: randomUUID(),
          event_id: burn.id,
          date,
          at: slot.at,
          label: slot.label,
          kind: slot.kind,
          food_idea: '',
        })),
    )

    if (wanted.length > 0) await db.insert(meal).values(wanted)

    return reply.code(201).send({ meals: await mealsFor(db, burn.id) })
  })

  app.post<{ Params: { eventId: string } }>(apiRoutes.addMeal.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(mealCreateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const id = randomUUID()

    try {
      await db.insert(meal).values({ ...body, id, event_id: request.params.eventId, food_idea: '' })
    } catch (failure) {
      if (isForeignKeyViolation(failure)) return sendError(reply, 404)
      // A second sitting of the same name on the same day, which the unique index
      // refuses. A 409 rather than a 400: the body is well formed and the burn simply
      // already has one.
      if (!isUniqueViolation(failure)) throw failure

      return sendError(reply, 409)
    }

    const created = await oneMeal(db, id)

    return created === undefined
      ? sendError(reply, 404)
      : reply.code(201).send({ meal: created } satisfies MealResponse)
  })

  app.delete<{ Params: { id: string } }>(apiRoutes.deleteMeal.fastify, async (request, reply) => {
    void noStore(reply)

    const deleted = await db.delete(meal).where(eq(meal.id, request.params.id)).returning({ id: meal.id })

    // Everyone signed up goes with it — `meal_role` cascades. That is what dropping a
    // sitting means, and why it is not something any member may do.
    return deleted.length === 0 ? sendError(reply, 404) : reply.code(204).send()
  })
}
