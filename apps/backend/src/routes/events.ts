import type { ActiveEventResponse, Event, EventResponse, EventsResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { errorResponse, eventCreateSchema, eventUpdateSchema } from '@sage-burner/shared'
import { and, asc, eq, gte, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'

import { createGuards } from '../auth/guards.ts'
import { event } from '../db/schema.ts'
import { noStore } from '../http.ts'

export interface EventRouteDeps extends GuardDeps {
  now?: () => Date
}

/**
 * Today as `YYYY-MM-DD`, UTC.
 *
 * UTC rather than a configured zone, deliberately: the only thing this decides
 * is when an event stops being the active one, and being a few hours out on the
 * day it ends changes nothing an organiser would notice. A timezone setting
 * would be a configuration knob, a migration and a test matrix bought for that.
 */
const todayIso = (now: () => Date) => now().toISOString().slice(0, 10)

/**
 * The active event: the soonest-ending event that has not ended yet.
 *
 * Stated as a rule rather than left implicit, because "the current event" is
 * the sort of thing that otherwise means something slightly different in each
 * place it is needed. Ties break on start date then slug so the answer is
 * deterministic when two events end the same day.
 *
 * **After the last event ends there is no active event, and the homepage says
 * so.** The alternative — falling back to the most recent past event — was
 * rejected: it leaves last year's welcome text on the public page indefinitely,
 * which reads as a live invitation to a burn that already happened. Creating
 * the next event is what fills the gap, and that is the action the organiser
 * wants prompting toward anyway.
 */
export const activeEvent = async (db: Database, today: string): Promise<Event | undefined> => {
  const [row] = await db
    .select()
    .from(event)
    .where(gte(event.end_date, today))
    .orderBy(asc(event.end_date), asc(event.start_date), asc(event.slug))
    .limit(1)

  return row
}

/**
 * The start-before-end condition for a PATCH, as SQL — or `undefined` when the
 * body cannot break the order.
 *
 * `eventUpdateSchema` tolerates a partial range, because a PATCH may legitimately
 * carry one date. When it carries **one**, the check has to compare the new value
 * against the column, inside the statement: a read-then-check leaves a window
 * where two organisers each moving one date both validate against the pre-update
 * row, and the second UPDATE then trips `event_date_order_check` and answers 500
 * — the outcome the check exists to avoid.
 *
 * When it carries **both**, there is nothing to race with: the ordering is
 * decided entirely by the body, so the caller checks it directly.
 */
const dateOrderCondition = ({ start_date, end_date }: { start_date?: string; end_date?: string }) => {
  if (start_date !== undefined && end_date !== undefined) return undefined
  if (start_date !== undefined) return sql`${start_date} <= ${event.end_date}`
  if (end_date !== undefined) return sql`${event.start_date} <= ${end_date}`
  return undefined
}

/** Whether `error` is SQLite refusing a duplicate `slug`. */
const isSlugConflict = (error: unknown) =>
  error instanceof Error && /UNIQUE constraint failed: event\.slug/i.test(error.message)

export const registerEventRoutes = (
  app: FastifyInstance,
  { db, sessions, now = () => new Date() }: EventRouteDeps,
) => {
  const { requireAdmin } = createGuards({ db, sessions })

  app.get('/api/events/active', async (_request, reply) => {
    // `no-cache`, not `no-store`. This is public content, so there is no reason
    // to forbid storing it — but #13 requires an edit to show up without a
    // redeploy, and with no `ETag` or `Last-Modified` the response would
    // otherwise be *heuristically* fresh and an organiser's correction could sit
    // invisible in a browser cache. `no-cache` means "store it, but revalidate
    // before reuse", which is exactly the requirement.
    void reply.header('cache-control', 'no-cache')

    const found = await activeEvent(db, todayIso(now))

    // Null rather than 404: having no event yet is the ordinary state of a
    // fresh deployment, not an error, and the homepage renders an explanation.
    return { event: found ?? null } satisfies ActiveEventResponse
  })

  app.get('/api/admin/events', { preHandler: requireAdmin }, async (_request, reply) => {
    void noStore(reply)

    const events = await db.select().from(event).orderBy(asc(event.start_date))

    return { events } satisfies EventsResponse
  })

  app.post('/api/admin/events', { preHandler: requireAdmin }, async (request, reply) => {
    void noStore(reply)

    const parsed = eventCreateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

    const row = { ...parsed.data, id: randomUUID(), created_at: now().toISOString() }

    try {
      await db.insert(event).values(row)
    } catch (error) {
      // The slug is in URLs, so a collision is a thing the organiser can fix by
      // choosing another — worth its own status rather than a generic 400.
      if (isSlugConflict(error)) return reply.code(409).send(errorResponse('conflict'))
      throw error
    }

    return reply.code(201).send({ event: row } satisfies EventResponse)
  })

  app.patch<{ Params: { id: string } }>(
    '/api/admin/events/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      void noStore(reply)

      const { id } = request.params
      const parsed = eventUpdateSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

      const [existing] = await db.select().from(event).where(eq(event.id, id)).limit(1)
      if (existing === undefined) return reply.code(404).send(errorResponse('not_found'))

      // A body of only unrecognised keys is a 400 from the schema now, so `{}`
      // is the one case left that changes nothing — and `set({})` is not valid
      // SQL, so it has to be answered before the UPDATE. A no-op PATCH is
      // idempotent; returning the row unchanged is the honest answer.
      if (Object.keys(parsed.data).length === 0) return { event: existing } satisfies EventResponse

      const merged = { ...existing, ...parsed.data }

      // Both dates given: the body decides the ordering on its own, so there is
      // nothing to race with.
      if (merged.end_date < merged.start_date) return reply.code(400).send(errorResponse('bad_request'))

      // One date given: the condition goes in the `where` so it is evaluated
      // against the row as it is at write time. See `dateOrderCondition`.
      const ordered = dateOrderCondition(parsed.data)
      const where = ordered === undefined ? eq(event.id, id) : and(eq(event.id, id), ordered)

      const result = await db
        .update(event)
        .set(parsed.data)
        .where(where)
        .catch((error: unknown) => {
          if (isSlugConflict(error)) return undefined
          throw error
        })

      if (result === undefined) return reply.code(409).send(errorResponse('conflict'))

      // Zero rows means the ordering condition failed: the id matched, since the
      // row was read a moment ago. The only other way here is the row being
      // deleted concurrently, and 400 is a defensible answer to that too.
      if (result.changes === 0) return reply.code(400).send(errorResponse('bad_request'))

      return { event: merged } satisfies EventResponse
    },
  )
}
