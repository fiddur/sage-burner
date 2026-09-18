import type { PantryPlacesResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import {
  apiRoutes,
  pantryPlaceCreateSchema,
  pantryPlaceOrderSchema,
  pantryPlaceUpdateSchema,
} from '@sage-burner/shared'
import { eq, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'

import { createGuards } from '../auth/guards.ts'
import { isForeignKeyViolation } from '../db/errors.ts'
import { nextOrder, reorder } from '../db/ordered.ts'
import { pantryPlace } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { pantryPlacesFor } from '../pantry-places.ts'

const named = sql`lower(trim(${pantryPlace.name}))`

const nameTaken = async (db: Database, name: string, except?: string): Promise<boolean> => {
  const rows = await db
    .select({ id: pantryPlace.id })
    .from(pantryPlace)
    .where(sql`${named} = lower(trim(${name}))`)

  return rows.some((row) => row.id !== except)
}

export const registerPantryPlaceRoutes = (app: FastifyInstance, { db, sessions }: GuardDeps) => {
  const { requireApproved } = createGuards({ db, sessions })

  app.get(apiRoutes.getPantryPlaces.fastify, { preHandler: requireApproved }, async (_request, reply) => {
    void reply.header('cache-control', 'no-cache')

    return { places: await pantryPlacesFor(db) } satisfies PantryPlacesResponse
  })

  app.post(apiRoutes.addPantryPlace.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(pantryPlaceCreateSchema, request)
    if (body === undefined) return sendError(reply, 400)
    if (await nameTaken(db, body.name)) return sendError(reply, 409)

    const id = randomUUID()

    const order = db.transaction((tx) => {
      const next = nextOrder(tx, pantryPlace)
      tx.insert(pantryPlace)
        .values({ ...body, id, order: next })
        .run()

      return next
    })

    return reply.code(201).send({ place: { ...body, id, order } })
  })

  app.patch<{ Params: { id: string } }>(apiRoutes.updatePantryPlace.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(pantryPlaceUpdateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    if (body.name !== undefined && (await nameTaken(db, body.name, request.params.id))) {
      return sendError(reply, 409)
    }

    if (Object.keys(body).length === 0) {
      const [row] = await db.select().from(pantryPlace).where(eq(pantryPlace.id, request.params.id)).limit(1)

      return row === undefined ? sendError(reply, 404) : { place: row }
    }

    const [updated] = await db
      .update(pantryPlace)
      .set(body)
      .where(eq(pantryPlace.id, request.params.id))
      .returning()

    return updated === undefined ? sendError(reply, 404) : { place: updated }
  })

  app.delete<{ Params: { id: string } }>(apiRoutes.deletePantryPlace.fastify, async (request, reply) => {
    void noStore(reply)

    let deleted
    try {
      deleted = await db
        .delete(pantryPlace)
        .where(eq(pantryPlace.id, request.params.id))
        .returning({ id: pantryPlace.id })
    } catch (failure) {
      if (isForeignKeyViolation(failure)) return sendError(reply, 409)
      throw failure
    }

    if (deleted.length === 0) return sendError(reply, 404)

    return reply.code(204).send()
  })

  app.put(apiRoutes.reorderPantryPlaces.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(pantryPlaceOrderSchema, request)
    if (body === undefined) return sendError(reply, 400)

    if (reorder(db, pantryPlace, await pantryPlacesFor(db), body.ids) === 'mismatch') {
      return sendError(reply, 400)
    }

    return { places: await pantryPlacesFor(db) } satisfies PantryPlacesResponse
  })
}
