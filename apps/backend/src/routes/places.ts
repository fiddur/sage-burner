import type { Place, PlacesResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { errorResponse, placeCreateSchema, placeOrderSchema, placeUpdateSchema } from '@sage-burner/shared'
import { asc, desc, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'

import { createGuards } from '../auth/guards.ts'
import { place } from '../db/schema.ts'
import { noStore } from '../http.ts'

/**
 * A place a dream still points at. SQLite reports the refusal as a foreign key
 * failure, and the message is the only thing distinguishing it.
 */
export const isPlaceInUse = (failure: unknown): boolean =>
  failure instanceof Error && failure.message.includes('FOREIGN KEY constraint failed')

export const placesFor = (db: Database): Promise<Place[]> =>
  db.select().from(place).orderBy(asc(place.order), asc(place.id))

/**
 * Where a dream can happen.
 *
 * Rows rather than code, the same as the application questions: the site
 * changes between burns and adding a place must never need a redeploy. One
 * central set, because the venue outlives any single burn.
 *
 * Reads are public. The ICS feed publishes a session's location to anyone with
 * the link, so the list of places is already public by design — see the ICS
 * paragraph in the README's security section. Every write is admin-only.
 */
export const registerPlaceRoutes = (app: FastifyInstance, { db, sessions }: GuardDeps) => {
  const { requireAdmin } = createGuards({ db, sessions })

  app.get('/api/places', async (_request, reply) => {
    // Same reasoning as the questions and the active event: public, but an edit
    // has to show up without waiting out a heuristic freshness window.
    void reply.header('cache-control', 'no-cache')

    return { places: await placesFor(db) } satisfies PlacesResponse
  })

  app.post('/api/admin/places', { preHandler: requireAdmin }, async (request, reply) => {
    void noStore(reply)

    const parsed = placeCreateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

    const id = randomUUID()

    // Read and insert in one transaction, or "the server assigns `order`" is not
    // true: two requests can observe the same last row between separate awaits
    // and claim the same position. Returned from the callback rather than
    // assigned into a row inside it — that would work only because
    // `drizzle-orm/node-sqlite` is synchronous, and on an async driver the
    // insert would be right while the 201 body reported `order: 0`.
    const order = db.transaction((tx) => {
      const [last] = tx.select({ order: place.order }).from(place).orderBy(desc(place.order)).limit(1).all()

      const next = last === undefined ? 0 : last.order + 1
      tx.insert(place)
        .values({ ...parsed.data, id, order: next })
        .run()

      return next
    })

    return reply.code(201).send({ place: { ...parsed.data, id, order } satisfies Place })
  })

  app.patch<{ Params: { id: string } }>(
    '/api/admin/places/:id',
    { preHandler: requireAdmin },
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
    '/api/admin/places/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      void noStore(reply)

      // A dream sitting in this lane holds the row: `session.place_id` has no
      // `onDelete`, so SQLite refuses rather than quietly unscheduling it. A
      // pre-read would be check-then-act — the dream can be created between the
      // read and the delete — so the constraint is the authority and this only
      // translates it.
      let deleted
      try {
        deleted = await db.delete(place).where(eq(place.id, request.params.id)).returning({ id: place.id })
      } catch (failure) {
        if (isPlaceInUse(failure)) return reply.code(409).send(errorResponse('conflict'))
        throw failure
      }

      if (deleted.length === 0) return reply.code(404).send(errorResponse('not_found'))

      // Deliberately does not renumber the survivors: `order` only has to sort,
      // not be contiguous, and renumbering here would fight a concurrent
      // reorder for no visible gain.
      return reply.code(204).send()
    },
  )

  app.put('/api/admin/places/order', { preHandler: requireAdmin }, async (request, reply) => {
    void noStore(reply)

    const parsed = placeOrderSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

    const existing = await placesFor(db)
    const wanted = parsed.data.ids

    // Exactly the places that exist, no more and no fewer. A partial list would
    // renumber some rows and leave the rest on stale positions, producing an
    // order nobody chose. Distinctness is implied rather than checked: `wanted`
    // has exactly `existing.length` slots and must contain every existing id,
    // and those are distinct because `id` is the primary key.
    const sameSet = wanted.length === existing.length && existing.every((row) => wanted.includes(row.id))
    if (!sameSet) return reply.code(400).send(errorResponse('bad_request'))

    // One statement per place, but in a transaction: a half-applied reorder is
    // an order the organiser never chose.
    db.transaction((tx) => {
      wanted.forEach((id, index) => {
        tx.update(place).set({ order: index }).where(eq(place.id, id)).run()
      })
    })

    return { places: await placesFor(db) } satisfies PlacesResponse
  })
}
