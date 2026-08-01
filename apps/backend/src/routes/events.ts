import type { ActiveEventResponse, Event, EventResponse, EventsResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { errorResponse, eventCreateSchema, eventUpdateSchema, hasOrderedRange } from '@sage-burner/shared'
import { asc, eq, gte } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'

import { createGuards } from '../auth/guards.ts'
import { isCheckViolation } from '../db/errors.ts'
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
export const todayIso = (now: () => Date) => now().toISOString().slice(0, 10)

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

      // The only body that never reaches the `UPDATE`. A body of only unrecognised
      // keys is a 400 from the schema now, so `{}` is the one case left that
      // changes nothing — and `set({})` is not valid SQL, so it has to be answered
      // before the statement. A no-op PATCH is idempotent; returning the row
      // unchanged is the honest answer.
      //
      // The read lives inside this branch rather than above it. It used to be
      // unconditional, and once `.returning()` landed that bought nothing for any
      // other body: the row comes back from the write, and a vanished row is
      // answered by the re-read below. All the pre-read did was spend a third
      // query to produce a 404 the write path produces anyway — and it left the
      // handler holding a pre-write snapshot to build the response from.
      if (Object.keys(parsed.data).length === 0) {
        const [existing] = await db.select().from(event).where(eq(event.id, id)).limit(1)

        return existing === undefined
          ? reply.code(404).send(errorResponse('not_found'))
          : ({ event: existing } satisfies EventResponse)
      }

      // The rule applied to the row as it would be, because a body carrying one
      // date — or only a time — cannot be judged on its own. A multi-day burn may
      // run 22:00 to 10:00; narrowing it to a single day makes that pair invalid,
      // and nothing in the body says so.
      //
      // This replaced a condition composed into the WHERE. That handled one date
      // against the stored other, but had no way to see the times, so those two
      // patches reached the database and came back as a 500 from
      // `event_date_order_check`.
      const [before] = await db.select().from(event).where(eq(event.id, id)).limit(1)
      if (before === undefined) return reply.code(404).send(errorResponse('not_found'))

      if (!hasOrderedRange({ ...before, ...parsed.data })) {
        return reply.code(400).send(errorResponse('bad_request'))
      }

      // `.returning()` rather than reading `changes`, for two reasons that turn out
      // to be the same one: the row it hands back is the row as written, so the
      // response cannot report a field from the pre-read snapshot that another
      // write has since changed — and an empty array means "no row matched" without
      // depending on SQLite counting a row whose SET values are identical, which
      // MySQL does not.
      const updated = await db
        .update(event)
        .set(parsed.data)
        .where(eq(event.id, id))
        .returning()
        .catch((error: unknown) => {
          if (isSlugConflict(error)) return 'conflict' as const
          // Only reachable when two patches merged against the same pre-write
          // row into a combination neither sent. Answered rather than thrown:
          // the caller can retry, and a 500 tells them nothing.
          if (isCheckViolation(error, 'event_date_order_check')) return 'unordered' as const
          throw error
        })

      if (updated === 'conflict') return reply.code(409).send(errorResponse('conflict'))
      if (updated === 'unordered') return reply.code(400).send(errorResponse('bad_request'))

      const [row] = updated
      if (row === undefined) {
        // One cause left, now the ordering is settled above: the row is gone,
        // deleted between the read and the write.
        const [stillThere] = await db.select({ id: event.id }).from(event).where(eq(event.id, id)).limit(1)

        return stillThere === undefined
          ? reply.code(404).send(errorResponse('not_found'))
          : reply.code(400).send(errorResponse('bad_request'))
      }

      return { event: row } satisfies EventResponse
    },
  )
}
