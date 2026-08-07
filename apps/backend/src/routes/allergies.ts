import type { AllergyItem, AllergyItemsResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import {
  allergyItemCreateSchema,
  allergyItemOrderSchema,
  allergyItemUpdateSchema,
  apiRoutes,
  errorResponse,
} from '@sage-burner/shared'
import { asc, desc, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { Database } from '../db/index.ts'

import { isForeignKeyViolation } from '../db/errors.ts'
import { allergyItem } from '../db/schema.ts'
import { noStore } from '../http.ts'

export const allergyItemsFor = (db: Database): Promise<AllergyItem[]> =>
  db.select().from(allergyItem).orderBy(asc(allergyItem.order), asc(allergyItem.id))

/**
 * The vocabulary of things somebody can say they cannot eat (#254).
 *
 * Global, unlike a burn's lanes and lodging: what somebody cannot eat is a fact
 * about them, so a per-burn list would mean re-ticking it every time. Rows rather
 * than an enum, so adding "Nuts" is an admin's afternoon rather than a deploy.
 *
 * Reading is **public**, like the application's questions: a list of foods says
 * nothing about anybody, and the invite form needs it before the account exists.
 * Writing is admin's — unlike the burn's shared furniture, this is a vocabulary
 * everybody's records are expressed in, and renaming an item rewrites what forty
 * people are taken to have said.
 */
export const registerAllergyRoutes = (app: FastifyInstance, { db }: { db: Database }) => {
  app.get(apiRoutes.getAllergyItems.fastify, async (_request, reply) => {
    // Same reasoning as the questions and the places: public, but an edit has to
    // show up without waiting out a heuristic freshness window.
    void reply.header('cache-control', 'no-cache')

    return { items: await allergyItemsFor(db) } satisfies AllergyItemsResponse
  })

  app.post(apiRoutes.addAllergyItem.fastify, async (request, reply) => {
    void noStore(reply)

    const parsed = allergyItemCreateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

    const id = randomUUID()

    // Read and insert in one transaction, or "the server assigns `order`" is not
    // true: two requests can observe the same last row between separate awaits and
    // claim the same position. Returned from the callback rather than assigned into
    // a row inside it, for the reason `places.ts` gives.
    const order = db.transaction((tx) => {
      const [last] = tx
        .select({ order: allergyItem.order })
        .from(allergyItem)
        .orderBy(desc(allergyItem.order))
        .limit(1)
        .all()

      const next = last === undefined ? 0 : last.order + 1
      tx.insert(allergyItem)
        .values({ ...parsed.data, id, order: next })
        .run()

      return next
    })

    return reply.code(201).send({ item: { ...parsed.data, id, order } satisfies AllergyItem })
  })

  app.patch<{ Params: { id: string } }>(apiRoutes.updateAllergyItem.fastify, async (request, reply) => {
    void noStore(reply)

    const parsed = allergyItemUpdateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

    // `set({})` is not valid SQL, so the one body that never reaches the UPDATE
    // reads instead.
    if (Object.keys(parsed.data).length === 0) {
      const [row] = await db.select().from(allergyItem).where(eq(allergyItem.id, request.params.id)).limit(1)

      return row === undefined ? reply.code(404).send(errorResponse('not_found')) : { item: row }
    }

    const [updated] = await db
      .update(allergyItem)
      .set(parsed.data)
      .where(eq(allergyItem.id, request.params.id))
      .returning()

    return updated === undefined ? reply.code(404).send(errorResponse('not_found')) : { item: updated }
  })

  app.delete<{ Params: { id: string } }>(apiRoutes.deleteAllergyItem.fastify, async (request, reply) => {
    void noStore(reply)

    // Somebody having ticked it holds the row: `account_allergy.item_id` has no
    // `onDelete`, so SQLite refuses rather than quietly dropping what people said
    // about what they cannot eat. Left to the constraint rather than a pre-read,
    // because a constraint cannot go stale and a read can. Renaming is what an admin
    // wants when a label is wrong; deleting is for one nobody uses.
    let deleted
    try {
      deleted = await db
        .delete(allergyItem)
        .where(eq(allergyItem.id, request.params.id))
        .returning({ id: allergyItem.id })
    } catch (failure) {
      if (isForeignKeyViolation(failure)) return reply.code(409).send(errorResponse('conflict'))
      throw failure
    }

    if (deleted.length === 0) return reply.code(404).send(errorResponse('not_found'))

    // Deliberately does not renumber the survivors: `order` only has to sort, not be
    // contiguous, and renumbering here would fight a concurrent reorder for nothing.
    return reply.code(204).send()
  })

  app.put(apiRoutes.reorderAllergyItems.fastify, async (request, reply) => {
    void noStore(reply)

    const parsed = allergyItemOrderSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

    const existing = await allergyItemsFor(db)
    const wanted = parsed.data.ids

    // Exactly the items there are, no more and no fewer. A partial list would
    // renumber some rows and leave the rest on stale positions, producing an order
    // nobody chose. Distinctness is implied: `wanted` has exactly `existing.length`
    // slots and must contain every existing id, and those are distinct because `id`
    // is the primary key.
    const sameSet = wanted.length === existing.length && existing.every((row) => wanted.includes(row.id))
    if (!sameSet) return reply.code(400).send(errorResponse('bad_request'))

    // One statement each, in a transaction: a half-applied reorder is an order
    // nobody chose.
    db.transaction((tx) => {
      wanted.forEach((id, index) => {
        tx.update(allergyItem).set({ order: index }).where(eq(allergyItem.id, id)).run()
      })
    })

    return { items: await allergyItemsFor(db) } satisfies AllergyItemsResponse
  })
}
