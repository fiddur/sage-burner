import type { CopySourcesResponse, Place, PlaceResponse, PlacesResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import {
  apiRoutes,
  placeCopySchema,
  placeCreateSchema,
  placeOrderSchema,
  placeUpdateSchema,
} from '@sage-burner/shared'
import { and, asc, eq, gte } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'

import { createGuards } from '../auth/guards.ts'
import { isForeignKeyViolation } from '../db/errors.ts'
import { nextOrder, reorder } from '../db/ordered.ts'
import { isEmptyPatch, patchRow } from '../db/patch.ts'
import { event, place } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { refuseIfStale, withCollectionVersion, withVersion } from '../if-match.ts'
import { copySourcesFor } from './copy-sources.ts'
import { openEventNow, todayIso } from './events.ts'

export interface PlaceDeps extends GuardDeps {
  now: () => Date
}

export const placesFor = (db: Database, eventId: string): Promise<Place[]> =>
  db.select().from(place).where(eq(place.event_id, eventId)).orderBy(asc(place.order), asc(place.id))

const openLane = async (db: Database, now: () => Date, placeId: string): Promise<Place | undefined> => {
  const [row] = await db
    .select()
    .from(place)
    .innerJoin(event, eq(place.event_id, event.id))
    .where(and(eq(place.id, placeId), gte(event.end_date, todayIso(now))))
    .limit(1)

  return row?.place
}

export const registerPlaceRoutes = (app: FastifyInstance, { db, sessions, now }: PlaceDeps) => {
  const { requireApproved } = createGuards({ db, sessions })

  const grid = async (eventId: string): Promise<PlacesResponse> => ({
    places: await placesFor(db, eventId),
  })

  app.get<{ Params: { eventId: string } }>(apiRoutes.getPlaces.fastify, async (request, reply) => {
    void reply.header('cache-control', 'no-cache')

    return withVersion(reply, await grid(request.params.eventId))
  })

  app.post<{ Params: { eventId: string } }>(
    apiRoutes.addPlace.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(placeCreateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const id = randomUUID()
      const event_id = request.params.eventId

      if (!(await openEventNow(db, now, event_id))) {
        return sendError(reply, 404)
      }

      let order: number
      try {
        order = db.transaction((tx) => {
          const next = nextOrder(tx, place, eq(place.event_id, event_id))
          tx.insert(place)
            .values({ ...body, id, event_id, order: next })
            .run()

          return next
        })
      } catch (failure) {
        if (isForeignKeyViolation(failure)) return sendError(reply, 404)
        throw failure
      }

      return reply.code(201).send({ place: { ...body, id, event_id, order } } satisfies PlaceResponse)
    },
  )

  app.patch<{ Params: { id: string } }>(
    apiRoutes.updatePlace.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(placeUpdateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const existing = await openLane(db, now, request.params.id)
      if (existing === undefined) return sendError(reply, 404)
      if (isEmptyPatch(body)) return { place: existing } satisfies PlaceResponse

      if (await refuseIfStale(request, reply, () => grid(existing.event_id))) return reply

      const patched = await patchRow(db, place, eq(place.id, request.params.id), body)
      if (patched.kind !== 'ok') return sendError(reply, 404)

      return await withCollectionVersion(reply, { place: patched.row } satisfies PlaceResponse, () =>
        grid(existing.event_id),
      )
    },
  )

  app.delete<{ Params: { id: string } }>(
    apiRoutes.deletePlace.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      if ((await openLane(db, now, request.params.id)) === undefined) {
        return sendError(reply, 404)
      }

      let deleted
      try {
        deleted = await db.delete(place).where(eq(place.id, request.params.id)).returning({ id: place.id })
      } catch (failure) {
        if (isForeignKeyViolation(failure)) return sendError(reply, 409)
        throw failure
      }

      if (deleted.length === 0) return sendError(reply, 404)

      return reply.code(204).send()
    },
  )

  app.put<{ Params: { eventId: string } }>(
    apiRoutes.reorderPlaces.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(placeOrderSchema, request)
      if (body === undefined) return sendError(reply, 400)

      if (!(await openEventNow(db, now, request.params.eventId))) {
        return sendError(reply, 404)
      }

      if (await refuseIfStale(request, reply, () => grid(request.params.eventId))) return reply

      const renumbered = reorder(
        db,
        place,
        await placesFor(db, request.params.eventId),
        body.ids,
        eq(place.event_id, request.params.eventId),
      )
      if (renumbered === 'mismatch') return sendError(reply, 400)

      return withVersion(reply, await grid(request.params.eventId))
    },
  )

  app.get<{ Params: { eventId: string } }>(
    apiRoutes.getPlaceSources.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const sources = await copySourcesFor(
        db,
        { table: place, eventColumn: place.event_id, idColumn: place.id },
        request.params.eventId,
      )

      return { sources } satisfies CopySourcesResponse
    },
  )

  app.post<{ Params: { eventId: string } }>(
    apiRoutes.copyPlaces.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(placeCopySchema, request)
      if (body === undefined) return sendError(reply, 400)
      if (body.from_event_id === request.params.eventId) {
        return sendError(reply, 400)
      }

      const today = todayIso(now)

      const seeded = db.transaction((tx) => {
        const [burn] = tx
          .select({ id: event.id })
          .from(event)
          .where(and(eq(event.id, request.params.eventId), gte(event.end_date, today)))
          .limit(1)
          .all()

        if (burn === undefined) return 'not_found' as const

        const [from] = tx
          .select({ id: event.id })
          .from(event)
          .where(eq(event.id, body.from_event_id))
          .limit(1)
          .all()

        if (from === undefined) return 'not_found' as const

        const [already] = tx
          .select({ id: place.id })
          .from(place)
          .where(eq(place.event_id, request.params.eventId))
          .limit(1)
          .all()

        if (already !== undefined) return 'conflict' as const

        const source = tx
          .select()
          .from(place)
          .where(eq(place.event_id, body.from_event_id))
          .orderBy(asc(place.order), asc(place.id))
          .all()

        for (const row of source) {
          tx.insert(place)
            .values({
              id: randomUUID(),
              event_id: request.params.eventId,
              order: row.order,
              name: row.name,
              emoji: row.emoji,
              color: row.color,
            })
            .run()
        }

        return 'copied' as const
      })

      if (seeded === 'not_found') return sendError(reply, 404)
      if (seeded === 'conflict') return sendError(reply, 409)

      return reply
        .code(201)
        .send({ places: await placesFor(db, request.params.eventId) } satisfies PlacesResponse)
    },
  )
}
