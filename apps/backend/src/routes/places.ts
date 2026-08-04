import type { CopySourcesResponse, Place, PlacesResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import {
  errorResponse,
  placeCopySchema,
  placeCreateSchema,
  placeOrderSchema,
  placeUpdateSchema,
} from '@sage-burner/shared'
import { and, asc, desc, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'

import { createGuards } from '../auth/guards.ts'
import { isForeignKeyViolation } from '../db/errors.ts'
import { event, place } from '../db/schema.ts'
import { noStore } from '../http.ts'
import { copySourcesFor } from './copy-sources.ts'

export const placesFor = (db: Database, eventId: string): Promise<Place[]> =>
  db.select().from(place).where(eq(place.event_id, eventId)).orderBy(asc(place.order), asc(place.id))

/**
 * Where a dream can happen, one grid per burn.
 *
 * Rows rather than code, the same as the application questions: the site changes
 * between burns and adding a place must never need a redeploy. **Per event**, so a
 * summer-only spot is not a lane in the winter grid and last year's event tent does
 * not outlive it (#156) — with a copy action, because the overlap between burns is
 * large and retyping it is the friction worth removing.
 *
 * Reads are public. The ICS feed publishes a session's location to anyone with the
 * link, so the list of places is already public by design — see the ICS paragraph
 * in the README's security section. Every write is open to any approved member: this
 * is the burn's furniture, not admin's.
 */
export const registerPlaceRoutes = (app: FastifyInstance, { db, sessions }: GuardDeps) => {
  const { requireApproved } = createGuards({ db, sessions })

  app.get<{ Params: { eventId: string } }>('/api/events/:eventId/places', async (request, reply) => {
    // Same reasoning as the questions and the active event: public, but an edit
    // has to show up without waiting out a heuristic freshness window.
    void reply.header('cache-control', 'no-cache')

    return { places: await placesFor(db, request.params.eventId) } satisfies PlacesResponse
  })

  app.post<{ Params: { eventId: string } }>(
    '/api/events/:eventId/places',
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const parsed = placeCreateSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

      const id = randomUUID()
      const event_id = request.params.eventId

      // Read and insert in one transaction, or "the server assigns `order`" is not
      // true: two requests can observe the same last row between separate awaits
      // and claim the same position. Returned from the callback rather than
      // assigned into a row inside it — that would work only because
      // `drizzle-orm/node-sqlite` is synchronous, and on an async driver the
      // insert would be right while the 201 body reported `order: 0`.
      //
      // The last row is *this burn's* last row. Numbering across all burns would
      // start a new burn's first lane at whatever the previous one reached.
      let order: number
      try {
        order = db.transaction((tx) => {
          const [last] = tx
            .select({ order: place.order })
            .from(place)
            .where(eq(place.event_id, event_id))
            .orderBy(desc(place.order))
            .limit(1)
            .all()

          const next = last === undefined ? 0 : last.order + 1
          tx.insert(place)
            .values({ ...parsed.data, id, event_id, order: next })
            .run()

          return next
        })
      } catch (failure) {
        // A burn that does not exist. The foreign key is the authority rather than
        // a pre-read, which would be a second query saying the same thing.
        if (isForeignKeyViolation(failure)) return reply.code(404).send(errorResponse('not_found'))
        throw failure
      }

      return reply.code(201).send({ place: { ...parsed.data, id, event_id, order } satisfies Place })
    },
  )

  app.patch<{ Params: { id: string } }>(
    '/api/places/:id',
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const parsed = placeUpdateSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

      // `set({})` is not valid SQL, so the one body that never reaches the
      // UPDATE needs a read of its own.
      if (Object.keys(parsed.data).length === 0) {
        const [existing] = await db.select().from(place).where(eq(place.id, request.params.id)).limit(1)

        return existing === undefined ? reply.code(404).send(errorResponse('not_found')) : { place: existing }
      }

      const [updated] = await db
        .update(place)
        .set(parsed.data)
        .where(eq(place.id, request.params.id))
        .returning()

      return updated === undefined ? reply.code(404).send(errorResponse('not_found')) : { place: updated }
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/places/:id',
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      // A dream sitting in this lane holds the row: `session.place_id` has no
      // `onDelete`, so SQLite refuses rather than quietly unscheduling it. A
      // pre-read would be check-then-act — the dream can be created between the
      // read and the delete — so the constraint is the authority and this only
      // translates it. It is also what keeps a finished burn's grid standing under
      // the record of what happened there.
      let deleted
      try {
        deleted = await db.delete(place).where(eq(place.id, request.params.id)).returning({ id: place.id })
      } catch (failure) {
        if (isForeignKeyViolation(failure)) return reply.code(409).send(errorResponse('conflict'))
        throw failure
      }

      if (deleted.length === 0) return reply.code(404).send(errorResponse('not_found'))

      // Deliberately does not renumber the survivors: `order` only has to sort,
      // not be contiguous, and renumbering here would fight a concurrent
      // reorder for no visible gain.
      return reply.code(204).send()
    },
  )

  app.put<{ Params: { eventId: string } }>(
    '/api/events/:eventId/places/order',
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const parsed = placeOrderSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

      const existing = await placesFor(db, request.params.eventId)
      const wanted = parsed.data.ids

      // Exactly the places this burn has, no more and no fewer. A partial list
      // would renumber some rows and leave the rest on stale positions, producing an
      // order nobody chose; another burn's id would reach into a grid this request
      // is not about. Distinctness is implied rather than checked: `wanted` has
      // exactly `existing.length` slots and must contain every existing id, and
      // those are distinct because `id` is the primary key.
      const sameSet = wanted.length === existing.length && existing.every((row) => wanted.includes(row.id))
      if (!sameSet) return reply.code(400).send(errorResponse('bad_request'))

      // One statement per place, but in a transaction: a half-applied reorder is
      // an order the organiser never chose. Scoped by event as well as id, so an id
      // from another burn could not renumber it even if the set check above were
      // wrong.
      db.transaction((tx) => {
        wanted.forEach((id, index) => {
          tx.update(place)
            .set({ order: index })
            .where(and(eq(place.id, id), eq(place.event_id, request.params.eventId)))
            .run()
        })
      })

      return { places: await placesFor(db, request.params.eventId) } satisfies PlacesResponse
    },
  )

  /** The burns whose grid this one's could be seeded from, newest first. */
  app.get<{ Params: { eventId: string } }>(
    '/api/events/:eventId/places/sources',
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

  /**
   * Seed this burn's grid from a previous burn's.
   *
   * The lanes, never the dreams standing in them: which burn's Temple a dream was in
   * is a fact about that burn. Refuses when this burn already has lanes, for the same
   * reason the roles register does — merging two grids is a decision nobody asked
   * for, and "copy into empty" is the case that removes the retyping.
   *
   * The check and the inserts are one transaction, or that refusal holds only when
   * nobody clicks twice at once. As with the register, `inject` runs requests to
   * completion in turn, so no test here can exercise that window.
   */
  app.post<{ Params: { eventId: string } }>(
    '/api/events/:eventId/places/copy',
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const parsed = placeCopySchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))
      if (parsed.data.from_event_id === request.params.eventId) {
        return reply.code(400).send(errorResponse('bad_request'))
      }

      const seeded = db.transaction((tx) => {
        // Checked rather than left to the foreign key. The FK only fires when there
        // is a row to insert, so copying from an empty source into a burn that does
        // not exist answered 201 with an empty list — the one combination the other
        // 404 test cannot reach.
        const [burn] = tx
          .select({ id: event.id })
          .from(event)
          .where(eq(event.id, request.params.eventId))
          .limit(1)
          .all()

        if (burn === undefined) return 'not_found' as const

        // The source too, and for the same reason. Without it, copying *from* a burn
        // that does not exist answered 201 with nothing copied — no different from a
        // real burn that simply has none.
        const [from] = tx
          .select({ id: event.id })
          .from(event)
          .where(eq(event.id, parsed.data.from_event_id))
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
          .where(eq(place.event_id, parsed.data.from_event_id))
          .orderBy(asc(place.order), asc(place.id))
          .all()

        // `order` is carried rather than reassigned, so the copied grid reads left
        // to right the way the burn it came from did.
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

      if (seeded === 'not_found') return reply.code(404).send(errorResponse('not_found'))
      if (seeded === 'conflict') return reply.code(409).send(errorResponse('conflict'))

      return reply
        .code(201)
        .send({ places: await placesFor(db, request.params.eventId) } satisfies PlacesResponse)
    },
  )
}
