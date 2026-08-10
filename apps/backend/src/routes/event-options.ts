import type { EventOptionResponse, EventOptionsResponse, EventOptionTaken } from '@sage-burner/shared'
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
import { isEmptyPatch, patchRow } from '../db/patch.ts'
import { attendance, eventOption } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { refuseIfStale, withCollectionVersion, withVersion } from '../if-match.ts'

const optionsFor = async (db: Database, eventId: string): Promise<EventOptionTaken[]> => {
  const rows = await db
    .select()
    .from(eventOption)
    .where(eq(eventOption.event_id, eventId))
    .orderBy(asc(eventOption.kind), asc(eventOption.order), asc(eventOption.id))

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

export const registerEventOptionRoutes = (app: FastifyInstance, { db, sessions }: GuardDeps) => {
  const { requireApproved } = createGuards({ db, sessions })

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
        if (isForeignKeyViolation(failure)) return sendError(reply, 404)
        throw failure
      }

      return reply.code(201).send({
        option: { ...body, id, event_id: eventId, order },
      } satisfies EventOptionResponse)
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

      if (isEmptyPatch(body)) return { option: existing } satisfies EventOptionResponse

      if (await refuseIfStale(request, reply, () => choices(existing.event_id))) return reply

      const patched = await patchRow(db, eventOption, eq(eventOption.id, request.params.id), body)
      if (patched.kind !== 'ok') return sendError(reply, 404)

      return await withCollectionVersion(reply, { option: patched.row } satisfies EventOptionResponse, () =>
        choices(existing.event_id),
      )
    },
  )

  app.delete<{ Params: { id: string } }>(
    apiRoutes.deleteEventOption.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

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

      const existing = (await optionsFor(db, eventId)).filter((row) => row.kind === kind)
      if (reorder(db, eventOption, existing, body.ids) === 'mismatch') return sendError(reply, 400)

      return withVersion(reply, await choices(eventId))
    },
  )
}
