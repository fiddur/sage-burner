import type { Meal, MealResponse, MealSlot, MealSlotsResponse, MealsResponse } from '@sage-burner/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import {
  errorResponse,
  mealIdeaUpdateSchema,
  mealIntroUpdateSchema,
  mealLeadSchema,
  mealSlotCreateSchema,
  mealSlotUpdateSchema,
} from '@sage-burner/shared'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'

import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { isForeignKeyViolation } from '../db/errors.ts'
import { account, attendance, event, mealNote, mealRole, mealSlot } from '../db/schema.ts'
import { noStore } from '../http.ts'
import { attendanceFor } from './attendance.ts'

export interface MealDeps extends GuardDeps {
  now?: () => Date
}

type Person = NonNullable<Meal['lead']>

/** The two roles anybody may put themselves on. The lead is one person, elsewhere. */
const STANDING = ['helper', 'cleanup'] as const

/**
 * Every date a slot at `at` produces a sitting on.
 *
 * The burn's own hours decide it, not its dates: a 13:00 lunch on a day the gates
 * open at 16:00 is not a meal anyone eats, and the last day ends when it ends. Both
 * comparisons are on fixed-width strings, which is sound for the reason the CHECKs
 * rely on — `09:00` cannot also arrive as `9:00`.
 */
export const sittingDates = (
  {
    start_date,
    end_date,
    start_time,
    end_time,
  }: Record<'start_date' | 'end_date' | 'start_time' | 'end_time', string>,
  at: string,
): string[] => {
  const dates: string[] = []
  const day = new Date(`${start_date}T00:00:00Z`)
  const last = new Date(`${end_date}T00:00:00Z`)
  if (Number.isNaN(day.getTime()) || Number.isNaN(last.getTime())) return dates

  while (day <= last) {
    const date = day.toISOString().slice(0, 10)
    const tooEarly = date === start_date && at < start_time
    const tooLate = date === end_date && at > end_time
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
 * The sittings a burn's slots produce, with whoever has signed up for each.
 *
 * One query for every role on every slot rather than one per sitting: a burn is a
 * handful of days and a handful of slots, and the page reads the lot at once.
 */
const mealsFor = async (
  db: Database,
  burn: typeof event.$inferSelect,
  slots: readonly MealSlot[],
): Promise<Meal[]> => {
  const signups =
    slots.length === 0
      ? []
      : await db
          .select({
            slot_id: mealRole.slot_id,
            date: mealRole.date,
            role: mealRole.role,
            account_id: account.id,
            name: account.name,
          })
          .from(mealRole)
          .innerJoin(attendance, eq(attendance.id, mealRole.attendance_id))
          .innerJoin(account, eq(account.id, attendance.account_id))
          .where(
            inArray(
              mealRole.slot_id,
              slots.map((slot) => slot.id),
            ),
          )
          .orderBy(asc(account.name), asc(account.id))

  const ideas =
    slots.length === 0
      ? []
      : await db
          .select()
          .from(mealNote)
          .where(
            inArray(
              mealNote.slot_id,
              slots.map((slot) => slot.id),
            ),
          )

  const key = (slotId: string, date: string) => `${slotId} ${date}`
  const idea = new Map(ideas.map((row) => [key(row.slot_id, row.date), row.food_idea]))
  const lead = new Map<string, Person>()
  const helpers = new Map<string, Person[]>()
  const cleanup = new Map<string, Person[]>()

  for (const row of signups) {
    const person = { account_id: row.account_id, name: row.name }
    const at = key(row.slot_id, row.date)
    if (row.role === 'lead') lead.set(at, person)
    if (row.role === 'helper') helpers.set(at, [...(helpers.get(at) ?? []), person])
    if (row.role === 'cleanup') cleanup.set(at, [...(cleanup.get(at) ?? []), person])
  }

  return slots.flatMap((slot) =>
    sittingDates(burn, slot.at).map((date) => ({
      slot_id: slot.id,
      date,
      label: slot.label,
      at: slot.at,
      kind: slot.kind,
      food_idea: idea.get(key(slot.id, date)) ?? '',
      lead: lead.get(key(slot.id, date)) ?? null,
      helpers: helpers.get(key(slot.id, date)) ?? [],
      cleanup: cleanup.get(key(slot.id, date)) ?? [],
    })),
  )
}

interface Refusal {
  code: 404
  error: 'not_found'
}

interface Sitting {
  slot: MealSlot
  burn: typeof event.$inferSelect
}

const burnOr404 = async (db: Database, eventId: string) => {
  const [row] = await db.select().from(event).where(eq(event.id, eventId)).limit(1)
  return row
}

/**
 * Meals — who cooks, who helps and who washes up, per sitting.
 *
 * `requireApproved` throughout, including the removals: this replaces a tab of a
 * spreadsheet everyone could edit, and the lead-roles register made the same call
 * for the same reason. What stays admin's is the burn's shape — the slots and the
 * kitchen — which is why those live under `/api/admin/`.
 */
export const registerMealRoutes = (app: FastifyInstance, { db, sessions }: MealDeps) => {
  const { requireApproved } = createGuards({ db, sessions })

  /** The slot and its burn, or the answer to give instead. */
  const sittingFor = async (
    request: FastifyRequest<{ Params: { slotId: string; date: string } }>,
  ): Promise<Refusal | Sitting> => {
    const [slot] = await db.select().from(mealSlot).where(eq(mealSlot.id, request.params.slotId)).limit(1)
    if (slot === undefined) return { code: 404, error: 'not_found' }

    const burn = await burnOr404(db, slot.event_id)
    if (burn === undefined) return { code: 404, error: 'not_found' }

    // A date the slot does not produce is not a sitting, however well-formed it
    // looks — otherwise a signup could be filed against a day the burn never ran.
    if (!sittingDates(burn, slot.at).includes(request.params.date)) {
      return { code: 404, error: 'not_found' }
    }

    return { slot, burn }
  }

  const answerWith = async (slot: MealSlot, burn: typeof event.$inferSelect, date: string) =>
    (await mealsFor(db, burn, [slot])).find((meal) => meal.date === date)

  app.get<{ Params: { eventId: string } }>(
    '/api/events/:eventId/meals',
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const burn = await burnOr404(db, request.params.eventId)
      if (burn === undefined) return reply.code(404).send(errorResponse('not_found'))

      const slots = await slotsFor(db, burn.id)

      return {
        intro_markdown: burn.meal_intro_markdown,
        slots,
        meals: await mealsFor(db, burn, slots),
      } satisfies MealsResponse
    },
  )

  /** The words above the table. Any approved member, like the burn's welcome text. */
  app.patch<{ Params: { eventId: string } }>(
    '/api/events/:eventId/meal-intro',
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const parsed = mealIntroUpdateSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

      const updated = await db
        .update(event)
        .set({ meal_intro_markdown: parsed.data.meal_intro_markdown })
        .where(eq(event.id, request.params.eventId))
        .returning({ intro: event.meal_intro_markdown })

      const [row] = updated

      return row === undefined
        ? reply.code(404).send(errorResponse('not_found'))
        : { meal_intro_markdown: row.intro }
    },
  )

  /**
   * Taking a sitting's lead, handing it to somebody, or vacating it.
   *
   * One route for all three, like the lead-roles register: they differ only in whose
   * id is in the body, and `null` vacates. The unique index is what makes "one lead"
   * true, so the write deletes whoever held it first rather than trusting a read.
   */
  app.put<{ Params: { slotId: string; date: string } }>(
    '/api/meals/:slotId/:date/lead',
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const parsed = mealLeadSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

      const found = await sittingFor(request)
      if ('code' in found) return reply.code(found.code).send(errorResponse(found.error))

      let taking: string | undefined
      if (parsed.data.account_id !== null) {
        taking = await attendanceFor(db, found.slot.event_id, parsed.data.account_id)

        // Not coming to this burn. A 400 rather than a 404: the account may well
        // exist, and what is wrong is the pairing.
        if (taking === undefined) return reply.code(400).send(errorResponse('bad_request'))
      }

      await db
        .delete(mealRole)
        .where(
          and(
            eq(mealRole.slot_id, found.slot.id),
            eq(mealRole.date, request.params.date),
            eq(mealRole.role, 'lead'),
          ),
        )

      if (taking !== undefined) {
        await db.insert(mealRole).values({
          slot_id: found.slot.id,
          date: request.params.date,
          attendance_id: taking,
          role: 'lead',
        })
      }

      const meal = await answerWith(found.slot, found.burn, request.params.date)

      return meal === undefined
        ? reply.code(404).send(errorResponse('not_found'))
        : ({ meal } satisfies MealResponse)
    },
  )

  /**
   * Putting yourself on a sitting's helpers or its cleanup crew, and taking yourself
   * off. `/me`: this is one person speaking for themselves.
   *
   * One handler for both verbs — they differ by an insert against a delete, and
   * splitting them would be the same nine lines of resolution written twice.
   */
  const stand =
    (joining: boolean) =>
    async (
      request: FastifyRequest<{ Params: { slotId: string; date: string; role: string } }>,
      reply: FastifyReply,
    ) => {
      void noStore(reply)

      // Only the two open-ended roles, and matched against the vocabulary rather than
      // compared away from it: excluding two literals from `string` narrows nothing,
      // so the row would go in with `role: string`. The lead has its own route, where
      // handing it over is a thing you may do to somebody else.
      const role = STANDING.find((candidate) => candidate === request.params.role)
      if (role === undefined) return reply.code(404).send(errorResponse('not_found'))

      const found = await sittingFor(request)
      if ('code' in found) return reply.code(found.code).send(errorResponse(found.error))

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return reply.code(401).send(errorResponse('unauthenticated'))

      const mine = await attendanceFor(db, found.slot.event_id, viewer.account_id)
      if (mine === undefined) return reply.code(400).send(errorResponse('bad_request'))

      const row = { slot_id: found.slot.id, date: request.params.date, attendance_id: mine, role }

      if (joining) {
        // Standing twice is standing once, which is what a double click sends.
        await db.insert(mealRole).values(row).onConflictDoNothing()
      } else {
        await db
          .delete(mealRole)
          .where(
            and(
              eq(mealRole.slot_id, row.slot_id),
              eq(mealRole.date, row.date),
              eq(mealRole.attendance_id, row.attendance_id),
              eq(mealRole.role, role),
            ),
          )
      }

      const meal = await answerWith(found.slot, found.burn, request.params.date)

      return meal === undefined
        ? reply.code(404).send(errorResponse('not_found'))
        : ({ meal } satisfies MealResponse)
    }

  /**
   * What somebody thought of cooking. Anyone may write it, and the lead is not bound
   * by it — the sheet's own header calls the column "Not needed".
   *
   * An empty string removes the note rather than storing one, so there is a row only
   * where there is something to say.
   */
  app.put<{ Params: { slotId: string; date: string } }>(
    '/api/meals/:slotId/:date/idea',
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const parsed = mealIdeaUpdateSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

      const found = await sittingFor(request)
      if ('code' in found) return reply.code(found.code).send(errorResponse(found.error))

      const idea = parsed.data.food_idea.trim()

      if (idea === '') {
        await db
          .delete(mealNote)
          .where(and(eq(mealNote.slot_id, found.slot.id), eq(mealNote.date, request.params.date)))
      } else {
        await db
          .insert(mealNote)
          .values({ slot_id: found.slot.id, date: request.params.date, food_idea: idea })
          .onConflictDoUpdate({ target: [mealNote.slot_id, mealNote.date], set: { food_idea: idea } })
      }

      const meal = await answerWith(found.slot, found.burn, request.params.date)

      return meal === undefined
        ? reply.code(404).send(errorResponse('not_found'))
        : ({ meal } satisfies MealResponse)
    },
  )

  app.put<{ Params: { slotId: string; date: string; role: string } }>(
    '/api/meals/:slotId/:date/:role/me',
    { preHandler: requireApproved },
    stand(true),
  )
  app.delete<{ Params: { slotId: string; date: string; role: string } }>(
    '/api/meals/:slotId/:date/:role/me',
    { preHandler: requireApproved },
    stand(false),
  )
}

/**
 * Configuring the slots — the burn's shape, so admin's.
 *
 * Under `/api/admin/`, which is guarded by one `onRequest` hook with no per-route
 * opt-out. Opening one of these would mean moving it out from under the prefix.
 */
export const registerMealSlotRoutes = (app: FastifyInstance, { db }: MealDeps) => {
  const answerSlots = async (eventId: string): Promise<MealSlotsResponse> => ({
    slots: await slotsFor(db, eventId),
  })

  app.get<{ Params: { eventId: string } }>(
    '/api/admin/events/:eventId/meal-slots',
    async (request, reply) => {
      void noStore(reply)

      return answerSlots(request.params.eventId)
    },
  )

  app.post<{ Params: { eventId: string } }>(
    '/api/admin/events/:eventId/meal-slots',
    async (request, reply) => {
      void noStore(reply)

      const parsed = mealSlotCreateSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

      const existing = await slotsFor(db, request.params.eventId)
      const order = existing.reduce((highest, slot) => Math.max(highest, slot.order + 1), 0)

      try {
        await db
          .insert(mealSlot)
          .values({ ...parsed.data, id: randomUUID(), event_id: request.params.eventId, order })
      } catch (failure) {
        if (isForeignKeyViolation(failure)) return reply.code(404).send(errorResponse('not_found'))
        throw failure
      }

      return reply.code(201).send(await answerSlots(request.params.eventId))
    },
  )

  app.patch<{ Params: { id: string } }>('/api/admin/meal-slots/:id', async (request, reply) => {
    void noStore(reply)

    const parsed = mealSlotUpdateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

    const [existing] = await db.select().from(mealSlot).where(eq(mealSlot.id, request.params.id)).limit(1)
    if (existing === undefined) return reply.code(404).send(errorResponse('not_found'))

    // `set({})` is not valid SQL, so an empty body reads instead of writing.
    if (Object.keys(parsed.data).length > 0) {
      await db.update(mealSlot).set(parsed.data).where(eq(mealSlot.id, request.params.id))
    }

    return answerSlots(existing.event_id)
  })

  app.delete<{ Params: { id: string } }>('/api/admin/meal-slots/:id', async (request, reply) => {
    void noStore(reply)

    const deleted = await db
      .delete(mealSlot)
      .where(eq(mealSlot.id, request.params.id))
      .returning({ event_id: mealSlot.event_id })

    const [row] = deleted

    // Everybody's signups go with it — `meal_role` cascades. That is the point of
    // letting a slot be removed at all: the slot is the thing, not the sign-ups.
    return row === undefined ? reply.code(404).send(errorResponse('not_found')) : reply.code(204).send()
  })
}
