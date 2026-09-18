import type { PantryItem, PantryItemResponse, PantryListResponse } from '@sage-burner/shared'
import type { FastifyInstance, FastifyReply } from 'fastify'

import { apiRoutes, pantryCreateSchema, pantryStockSchema, pantryUpdateSchema } from '@sage-burner/shared'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'

import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { isEmptyPatch } from '../db/patch.ts'
import { account, pantryItem } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'

export interface PantryDeps extends GuardDeps {
  now: () => Date
}

const columns = {
  id: pantryItem.id,
  kind: pantryItem.kind,
  name: pantryItem.name,
  unit: pantryItem.unit,
  where: pantryItem.where,
  stock_level: pantryItem.stock_level,
  stock_amount: pantryItem.stock_amount,
  counted_by: pantryItem.counted_by,
  counted_by_name: account.name,
  counted_at: pantryItem.counted_at,
  withdrawn_at: pantryItem.withdrawn_at,
  created_at: pantryItem.created_at,
}

const byName = sql`lower(trim(${pantryItem.name}))`

const listing = (db: Database) =>
  db.select(columns).from(pantryItem).leftJoin(account, eq(account.id, pantryItem.counted_by))

export const pantryFor = (db: Database): Promise<PantryItem[]> => listing(db).orderBy(byName)

const oneItem = async (db: Database, id: string): Promise<PantryItem | undefined> => {
  const [row] = await listing(db).where(eq(pantryItem.id, id)).limit(1)

  return row
}

const nameTaken = async (db: Database, name: string, except?: string): Promise<boolean> => {
  const rows = await db
    .select({ id: pantryItem.id })
    .from(pantryItem)
    .where(sql`${byName} = lower(trim(${name}))`)

  return rows.some((row) => row.id !== except)
}

export const registerPantryRoutes = (app: FastifyInstance, { db, sessions, now }: PantryDeps) => {
  const { requireApproved } = createGuards({ db, sessions })

  const guarded = { preHandler: requireApproved }

  const answer = async (reply: FastifyReply, id: string) => {
    const item = await oneItem(db, id)

    return item === undefined ? sendError(reply, 404) : ({ item } satisfies PantryItemResponse)
  }

  app.get(apiRoutes.getPantry.fastify, guarded, async (_request, reply) => {
    void noStore(reply)

    return { items: await pantryFor(db) } satisfies PantryListResponse
  })

  app.put<{ Params: { id: string } }>(apiRoutes.setPantryStock.fastify, guarded, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(pantryStockSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    const counted =
      body.level === null
        ? { stock_level: null, stock_amount: null, counted_by: null, counted_at: null }
        : {
            stock_level: body.level,
            stock_amount: body.amount,
            counted_by: viewer.account_id,
            counted_at: now().toISOString(),
          }

    const written = await db
      .update(pantryItem)
      .set(counted)
      .where(and(eq(pantryItem.id, request.params.id), isNull(pantryItem.withdrawn_at)))
      .returning({ id: pantryItem.id })

    if (written.length === 0) return sendError(reply, 404)

    return await answer(reply, request.params.id)
  })

  app.post(apiRoutes.addPantryItem.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(pantryCreateSchema, request)
    if (body === undefined) return sendError(reply, 400)
    if (await nameTaken(db, body.name)) return sendError(reply, 409)

    const id = randomUUID()

    await db.insert(pantryItem).values({ ...body, id, created_at: now().toISOString() })

    const item = await oneItem(db, id)
    if (item === undefined) return sendError(reply, 404)

    return reply.code(201).send({ item } satisfies PantryItemResponse)
  })

  app.patch<{ Params: { id: string } }>(apiRoutes.updatePantryItem.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(pantryUpdateSchema, request)
    if (body === undefined || isEmptyPatch(body)) return sendError(reply, 400)

    const existing = await oneItem(db, request.params.id)
    if (existing === undefined) return sendError(reply, 404)

    if (body.name !== undefined && (await nameTaken(db, body.name, existing.id))) {
      return sendError(reply, 409)
    }

    await db.update(pantryItem).set(body).where(eq(pantryItem.id, existing.id))

    return await answer(reply, existing.id)
  })

  app.delete<{ Params: { id: string } }>(apiRoutes.withdrawPantryItem.fastify, async (request, reply) => {
    void noStore(reply)

    const existing = await oneItem(db, request.params.id)
    if (existing === undefined) return sendError(reply, 404)

    if (existing.withdrawn_at === null) {
      await db
        .update(pantryItem)
        .set({ withdrawn_at: now().toISOString() })
        .where(eq(pantryItem.id, existing.id))
    }

    return reply.code(204).send()
  })

  app.post<{ Params: { id: string } }>(apiRoutes.restorePantryItem.fastify, async (request, reply) => {
    void noStore(reply)

    const existing = await oneItem(db, request.params.id)
    if (existing === undefined) return sendError(reply, 404)

    if (existing.withdrawn_at !== null) {
      await db.update(pantryItem).set({ withdrawn_at: null }).where(eq(pantryItem.id, existing.id))
    }

    return await answer(reply, existing.id)
  })
}
