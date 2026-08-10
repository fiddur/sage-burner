import type { AllergyItem, AllergyItemsResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import {
  allergyItemCreateSchema,
  allergyItemOrderSchema,
  allergyItemUpdateSchema,
  apiRoutes,
} from '@sage-burner/shared'
import { asc, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { Database } from '../db/index.ts'

import { isForeignKeyViolation } from '../db/errors.ts'
import { nextOrder, reorder } from '../db/ordered.ts'
import { allergyItem } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'

export const allergyItemsFor = (db: Database): Promise<AllergyItem[]> =>
  db.select().from(allergyItem).orderBy(asc(allergyItem.order), asc(allergyItem.id))

export const registerAllergyRoutes = (app: FastifyInstance, { db }: { db: Database }) => {
  app.get(apiRoutes.getAllergyItems.fastify, async (_request, reply) => {
    void reply.header('cache-control', 'no-cache')

    return { items: await allergyItemsFor(db) } satisfies AllergyItemsResponse
  })

  app.post(apiRoutes.addAllergyItem.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(allergyItemCreateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const id = randomUUID()

    const order = db.transaction((tx) => {
      const next = nextOrder(tx, allergyItem)
      tx.insert(allergyItem)
        .values({ ...body, id, order: next })
        .run()

      return next
    })

    return reply.code(201).send({ item: { ...body, id, order } satisfies AllergyItem })
  })

  app.patch<{ Params: { id: string } }>(apiRoutes.updateAllergyItem.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(allergyItemUpdateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    if (Object.keys(body).length === 0) {
      const [row] = await db.select().from(allergyItem).where(eq(allergyItem.id, request.params.id)).limit(1)

      return row === undefined ? sendError(reply, 404) : { item: row }
    }

    const [updated] = await db
      .update(allergyItem)
      .set(body)
      .where(eq(allergyItem.id, request.params.id))
      .returning()

    return updated === undefined ? sendError(reply, 404) : { item: updated }
  })

  app.delete<{ Params: { id: string } }>(apiRoutes.deleteAllergyItem.fastify, async (request, reply) => {
    void noStore(reply)

    let deleted
    try {
      deleted = await db
        .delete(allergyItem)
        .where(eq(allergyItem.id, request.params.id))
        .returning({ id: allergyItem.id })
    } catch (failure) {
      if (isForeignKeyViolation(failure)) return sendError(reply, 409)
      throw failure
    }

    if (deleted.length === 0) return sendError(reply, 404)

    return reply.code(204).send()
  })

  app.put(apiRoutes.reorderAllergyItems.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(allergyItemOrderSchema, request)
    if (body === undefined) return sendError(reply, 400)

    if (reorder(db, allergyItem, await allergyItemsFor(db), body.ids) === 'mismatch') {
      return sendError(reply, 400)
    }

    return { items: await allergyItemsFor(db) } satisfies AllergyItemsResponse
  })
}
