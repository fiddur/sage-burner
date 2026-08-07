import type { EventOption, EventOptionTaken, EventOptionsResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import {
  apiRoutes,
  eventOptionCreateSchema,
  eventOptionOrderSchema,
  eventOptionUpdateSchema,
  isEventOptionKind,
} from '@sage-burner/shared'
import { and, asc, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'

import { createGuards } from '../auth/guards.ts'
import { isForeignKeyViolation } from '../db/errors.ts'
import { nextOrder, reorder } from '../db/ordered.ts'
import { attendance, eventOption } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { refuseIfStale, withCollectionVersion, withVersion } from '../if-match.ts'

const optionsFor = async (db: Database, eventId: string): Promise<EventOptionTaken[]> => {
  const rows = await db
    .select()
    .from(eventOption)
    .where(eq(eventOption.event_id, eventId))
    .orderBy(asc(eventOption.kind), asc(eventOption.order), asc(eventOption.id))

  // One query for every count rather than one per option: at this size the whole
  // table is a handful of rows, and a loop of selects would be the slower, longer
  // way to say the same thing.
  const takers = await db
    .select({ option: attendance.lodging_option_id })
    .from(attendance)
    .where(eq(attendance.event_id, eventId))

  const counts = new Map<string, number>()
  for (const { option } of takers) {
    if (option !== null) counts.set(option, (counts.get(option) ?? 0) + 1)
  }

  return rows.map((row) => ({ ...row, taken: counts.get(row.id) ?? 0 }))
}

/**
 * The two lists a member picks from for a given burn.
 *
 * Rows rather than a shared vocabulary, per event rather than per community:
 * what there is to sleep in depends on the site, and what wants doing depends on
 * the year. Reads are public for the same reason the places are — nothing here
 * is about a person.
 */
export const registerEventOptionRoutes = (app: FastifyInstance, { db, sessions }: GuardDeps) => {
  const { requireApproved } = createGuards({ db, sessions })

  /** The lists, as both the `GET` and the `If-Match` guards see them (#274). */
  const choices = async (eventId: string): Promise<EventOptionsResponse> => ({
    options: await optionsFor(db, eventId),
  })

  app.get<{ Params: { eventId: string } }>(apiRoutes.getEventOptions.fastify, async (request, reply) => {
    void reply.header('cache-control', 'no-cache')

    return withVersion(reply, await choices(request.params.eventId))
  })

  app.post<{ Params: { eventId: string } }>(
    apiRoutes.addEventOption.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(eventOptionCreateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const { eventId } = request.params
      const id = randomUUID()

      // Read and insert together, so "the server assigns `order`" holds rather
      // than two adds claiming the same position. Per kind: the two lists number
      // independently.
      let order: number
      try {
        order = db.transaction((tx) => {
          const next = nextOrder(
            tx,
            eventOption,
            and(eq(eventOption.event_id, eventId), eq(eventOption.kind, body.kind)),
          )
          tx.insert(eventOption)
            .values({ ...body, id, event_id: eventId, order: next })
            .run()

          return next
        })
      } catch (failure) {
        // No pre-read of the event: the foreign key already rejects a missing
        // one, and asking first would be a second query saying the same thing.
        if (isForeignKeyViolation(failure)) return sendError(reply, 404)
        throw failure
      }

      return reply.code(201).send({
        option: { ...body, id, event_id: eventId, order } satisfies EventOption,
      })
    },
  )

  app.patch<{ Params: { id: string } }>(
    apiRoutes.updateEventOption.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(eventOptionUpdateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const [existing] = await db
        .select()
        .from(eventOption)
        .where(eq(eventOption.id, request.params.id))
        .limit(1)

      if (existing === undefined) return sendError(reply, 404)

      // `set({})` is not valid SQL, and a no-op PATCH is a read — so it answers with
      // the row rather than writing, and needs no precondition.
      if (Object.keys(body).length === 0) return { option: existing }

      if (await refuseIfStale(request, reply, () => choices(existing.event_id))) return reply

      const [updated] = await db
        .update(eventOption)
        .set(body)
        .where(eq(eventOption.id, request.params.id))
        .returning()
      if (updated === undefined) return sendError(reply, 404)

      return await withCollectionVersion(reply, { option: updated }, () => choices(existing.event_id))
    },
  )

  app.delete<{ Params: { id: string } }>(
    apiRoutes.deleteEventOption.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      // Somebody sleeping here holds the row: `attendance.lodging_option_id` has
      // no `onDelete`, so SQLite refuses rather than quietly unbooking them. A
      // pre-read would be check-then-act — someone can pick it between the read
      // and the delete — so the constraint is the authority and this translates.
      let deleted
      try {
        deleted = await db
          .delete(eventOption)
          .where(eq(eventOption.id, request.params.id))
          .returning({ id: eventOption.id })
      } catch (failure) {
        if (isForeignKeyViolation(failure)) return sendError(reply, 409)
        throw failure
      }

      if (deleted.length === 0) return sendError(reply, 404)

      return reply.code(204).send()
    },
  )

  app.put<{ Params: { eventId: string; kind: string } }>(
    apiRoutes.reorderEventOptions.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const { eventId, kind } = request.params
      if (!isEventOptionKind(kind)) return sendError(reply, 404)

      const body = bodyOf(eventOptionOrderSchema, request)
      if (body === undefined) return sendError(reply, 400)

      if (await refuseIfStale(request, reply, () => choices(eventId))) return reply

      // Exactly this kind's options — the two lists number independently, so the
      // set is filtered to one kind before `reorder` is asked about it.
      const existing = (await optionsFor(db, eventId)).filter((row) => row.kind === kind)
      if (reorder(db, eventOption, existing, body.ids) === 'mismatch') return sendError(reply, 400)

      return withVersion(reply, await choices(eventId))
    },
  )
}
