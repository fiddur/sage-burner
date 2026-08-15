import type {
  Meal,
  MealResponse,
  MealSlot,
  MealSlotsResponse,
  MealsResponse,
  ThreadEntryKind,
} from '@sage-burner/shared'
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
  mealsPage,
  mealUpdateSchema,
} from '@sage-burner/shared'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'
import type { Notifier } from '../push/notify.ts'

import { accountForAttendance, attendanceFor } from '../attendances.ts'
import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { isForeignKeyViolation, isUniqueViolation } from '../db/errors.ts'
import { account, attendance, event, meal, mealRole, mealSlot } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { refuseIfStale, withCollectionVersion, withVersion } from '../if-match.ts'
import { displayName, tellAttendees } from '../push/notify.ts'
import { openEventNow } from './events.ts'
import { addEntry, forgetThread, threadFor } from './threads.ts'

export interface MealDeps extends GuardDeps {
  now: () => Date
  notify?: Notifier
}

type Person = NonNullable<Meal['lead']>
type MealRow = typeof meal.$inferSelect
type Burn = typeof event.$inferSelect

type BurnSpan = Pick<Burn, 'end_date' | 'end_time' | 'start_date' | 'start_time'>

const STANDING = ['helper', 'cleanup'] as const

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

export const registerMealRoutes = (
  app: FastifyInstance,
  { db, sessions, now, notify = async () => undefined }: MealDeps,
) => {
  const { requireApproved } = createGuards({ db, sessions })

  const tell = async (by: string, accountId: string, eventId: string, message: string) => {
    if (accountId === by) return

    await notify(accountId, { category: 'meal_role', body: message, link: mealsPage(eventId) })
  }

  const tellTheBurn = async (
    sitting: { event_id: string; label: string },
    by: string,
    taker: string,
    message: string,
  ) => {
    await tellAttendees(
      db,
      notify,
      sitting.event_id,
      { category: 'meal_taken', body: message, link: mealsPage(sitting.event_id) },
      { except: [by, taker] },
    )
  }

  const noteOnMeal = async (
    sitting: { id: string; event_id: string; label: string },
    kind: ThreadEntryKind,
    by: string | undefined,
    body: string,
  ) => {
    const card = await threadFor(db, 'meal', {
      id: sitting.id,
      event_id: sitting.event_id,
      title: sitting.label,
    })

    await addEntry(db, { thread_id: card, kind, author_account_id: by ?? null, body }, now())
  }

  const cookMoved = async (sitting: MealRow, by: string, was: string | undefined, after: string | null) => {
    if (was !== undefined && was !== after) {
      await tell(by, was, sitting.event_id, `You are no longer leading ${sitting.label}`)
    }
    if (after !== null && after !== was) {
      await tell(by, after, sitting.event_id, `You are leading ${sitting.label}`)
    }

    const said = await cookLine(by, was, after)
    if (said !== undefined) await noteOnMeal(sitting, 'facilitator', by, said)

    if (after === null || after === was) return

    await tellTheBurn(sitting, by, after, `${await displayName(db, after)} is cooking ${sitting.label}`)
  }

  const cookLine = async (by: string, was: string | undefined, after: string | null) => {
    if (after === null) {
      if (was === undefined) return undefined

      return was === by ? 'stepped back from cooking it' : `took ${await displayName(db, was)} off cooking it`
    }

    if (after === was) return undefined
    if (after === by) return was === undefined ? 'is cooking it' : 'took over the cooking'

    return `asked ${await displayName(db, after)} to cook it`
  }

  const openMeal = async (id: string): Promise<MealRow | undefined> => {
    const [row] = await db.select().from(meal).where(eq(meal.id, id)).limit(1)
    if (row === undefined) return undefined

    return (await openEventNow(db, now, row.event_id)) === undefined ? undefined : row
  }

  const plan = async (eventId: string): Promise<MealsResponse> => {
    const burn = await burnFor(db, eventId)

    return {
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

  app.patch<{ Params: { eventId: string } }>(
    apiRoutes.updateMealIntro.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(mealIntroUpdateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      if ((await openEventNow(db, now, request.params.eventId)) === undefined) {
        return sendError(reply, 404)
      }

      if (await refuseIfStale(request, reply, () => plan(request.params.eventId))) return reply

      const [row] = await db
        .update(event)
        .set({ meal_intro_markdown: body.meal_intro_markdown })
        .where(eq(event.id, request.params.eventId))
        .returning({ intro: event.meal_intro_markdown })
      if (row === undefined) return sendError(reply, 404)

      return await withCollectionVersion(reply, { meal_intro_markdown: row.intro }, () =>
        plan(request.params.eventId),
      )
    },
  )

  app.put<{ Params: { id: string } }>(
    apiRoutes.setMealLead.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(mealLeadSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const existing = await openMeal(request.params.id)
      if (existing === undefined) return sendError(reply, 404)

      if (existing.kind === 'chore' && body.account_id !== null) {
        return sendError(reply, 400)
      }

      let taking: string | undefined
      if (body.account_id !== null) {
        taking = await attendanceFor(db, existing.event_id, body.account_id)

        if (taking === undefined) return sendError(reply, 400, 'not_attending')
      }

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

      const viewer = await viewerFor(request, { db, sessions })

      await cookMoved(existing, viewer?.account_id ?? '', held, body.account_id)

      return answer(reply, existing.id)
    },
  )

  const stand =
    (joining: boolean) =>
    async (
      request: FastifyRequest<{ Params: { id: string; role: string; accountId?: string } }>,
      reply: FastifyReply,
    ) => {
      void noStore(reply)

      const role = STANDING.find((candidate) => candidate === request.params.role)
      if (role === undefined) return sendError(reply, 404)

      const existing = await openMeal(request.params.id)
      if (existing === undefined) return sendError(reply, 404)

      if (existing.kind === 'chore' && role === 'helper' && joining) {
        return sendError(reply, 400)
      }

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      const accountId = whoseHands(joining, request)
      if (accountId === undefined) return sendError(reply, 400)

      const mine = await attendanceFor(db, existing.event_id, accountId)
      if (mine === undefined) return sendError(reply, 400, 'not_attending')

      const row = { meal_id: existing.id, attendance_id: mine, role }

      if (joining) {
        const added = await db.insert(mealRole).values(row).onConflictDoNothing().returning()

        if (added.length > 0) {
          await tell(
            viewer.account_id,
            accountId,
            existing.event_id,
            `You are on ${role} for ${existing.label}`,
          )
          await noteOnMeal(
            existing,
            'helper',
            viewer.account_id,
            accountId === viewer.account_id
              ? `put a hand up for ${role}`
              : `asked ${await displayName(db, accountId)} onto ${role}`,
          )
          await tellTheBurn(
            existing,
            viewer.account_id,
            accountId,
            `${await displayName(db, accountId)} is on ${role} for ${existing.label}`,
          )
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

        if (gone.length > 0) {
          await tell(
            viewer.account_id,
            accountId,
            existing.event_id,
            `You are off ${role} for ${existing.label}`,
          )
          await noteOnMeal(
            existing,
            'helper',
            viewer.account_id,
            accountId === viewer.account_id
              ? `cannot do ${role} after all`
              : `took ${await displayName(db, accountId)} off ${role}`,
          )
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

  app.patch<{ Params: { id: string } }>(
    apiRoutes.updateMeal.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(mealUpdateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const existing = await openMeal(request.params.id)
      if (existing === undefined) return sendError(reply, 404)

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
          if (!isUniqueViolation(failure)) throw failure

          return sendError(reply, 409)
        }
      }

      return answer(reply, request.params.id)
    },
  )

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

      const idea = body.food_idea.trim()
      await db.update(meal).set({ food_idea: idea }).where(eq(meal.id, existing.id))

      if (idea !== existing.food_idea) {
        const viewer = await viewerFor(request, { db, sessions })
        await noteOnMeal(
          existing,
          'edited',
          viewer?.account_id,
          idea === '' ? 'took the food idea off it' : `said what it will be: ${idea}`,
        )
      }

      return answer(reply, existing.id)
    },
  )
}

const whoseHands = (
  joining: boolean,
  request: FastifyRequest<{ Params: { id: string; role: string; accountId?: string } }>,
): string | undefined => {
  if (!joining) return request.params.accountId

  return bodyOf(helperSchema, request)?.account_id
}

export const registerMealAdminRoutes = (app: FastifyInstance, { db, now }: MealDeps) => {
  const answerSlots = async (eventId: string): Promise<MealSlotsResponse> => ({
    slots: await slotsFor(db, eventId),
  })

  app.get<{ Params: { eventId: string } }>(apiRoutes.getMealSlots.fastify, async (request, reply) => {
    void noStore(reply)

    const burn = await burnFor(db, request.params.eventId)
    if (burn === undefined) return sendError(reply, 404)

    return answerSlots(burn.id)
  })

  app.post<{ Params: { eventId: string } }>(apiRoutes.addMealSlot.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(mealSlotCreateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    if ((await openEventNow(db, now, request.params.eventId)) === undefined) return sendError(reply, 404)

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
    if ((await openEventNow(db, now, existing.event_id)) === undefined) return sendError(reply, 404)

    if (Object.keys(body).length > 0) {
      await db.update(mealSlot).set(body).where(eq(mealSlot.id, request.params.id))
    }

    return answerSlots(existing.event_id)
  })

  app.delete<{ Params: { id: string } }>(apiRoutes.deleteMealSlot.fastify, async (request, reply) => {
    void noStore(reply)

    const [existing] = await db
      .select({ event_id: mealSlot.event_id })
      .from(mealSlot)
      .where(eq(mealSlot.id, request.params.id))
      .limit(1)
    if (existing === undefined) return sendError(reply, 404)
    if ((await openEventNow(db, now, existing.event_id)) === undefined) return sendError(reply, 404)

    await db.delete(mealSlot).where(eq(mealSlot.id, request.params.id))

    return reply.code(204).send()
  })

  app.post<{ Params: { eventId: string } }>(apiRoutes.generateMeals.fastify, async (request, reply) => {
    void noStore(reply)

    const burn = await openEventNow(db, now, request.params.eventId)
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

    if ((await openEventNow(db, now, request.params.eventId)) === undefined) return sendError(reply, 404)

    const id = randomUUID()

    try {
      await db.insert(meal).values({ ...body, id, event_id: request.params.eventId, food_idea: '' })
    } catch (failure) {
      if (isForeignKeyViolation(failure)) return sendError(reply, 404)
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

    const [existing] = await db
      .select({ event_id: meal.event_id })
      .from(meal)
      .where(eq(meal.id, request.params.id))
      .limit(1)
    if (existing === undefined) return sendError(reply, 404)
    if ((await openEventNow(db, now, existing.event_id)) === undefined) return sendError(reply, 404)

    db.transaction((tx) => {
      tx.delete(meal).where(eq(meal.id, request.params.id)).run()
      forgetThread(tx, 'meal', request.params.id)
    })

    return reply.code(204).send()
  })
}
