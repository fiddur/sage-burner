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

    const body = bodyOf(allergyItemCreateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const id = randomUUID()

    // One transaction, for the reason `nextOrder` gives. Returned from the callback
    // rather than read back off a row inside it, for the reason `places.ts` gives.
    // No scope: there is one list of these, shared by every burn.
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

    // `set({})` is not valid SQL, so the one body that never reaches the UPDATE
    // reads instead.
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
      if (isForeignKeyViolation(failure)) return sendError(reply, 409)
      throw failure
    }

    if (deleted.length === 0) return sendError(reply, 404)

    // Deliberately does not renumber the survivors: `order` only has to sort, not be
    // contiguous, and renumbering here would fight a concurrent reorder for nothing.
    return reply.code(204).send()
  })

  app.put(apiRoutes.reorderAllergyItems.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(allergyItemOrderSchema, request)
    if (body === undefined) return sendError(reply, 400)

    // Exactly the items there are — `reorder` argues that rule out, and owns it for
    // every list that has one.
    if (reorder(db, allergyItem, await allergyItemsFor(db), body.ids) === 'mismatch') {
      return sendError(reply, 400)
    }

    return { items: await allergyItemsFor(db) } satisfies AllergyItemsResponse
  })
}
