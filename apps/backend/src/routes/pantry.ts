import type {
  AllergyTag,
  EventPantryResponse,
  PantryItem,
  PantryItemResponse,
  PantryListResponse,
  PantryPlacing,
} from '@sage-burner/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import {
  apiRoutes,
  pantryCreateSchema,
  pantrySpotSchema,
  pantryStockSchema,
  pantryUpdateSchema,
} from '@sage-burner/shared'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'

import { attendanceFor } from '../attendances.ts'
import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { isEmptyPatch } from '../db/patch.ts'
import { account, pantryHeart, pantryItem, pantryItemPlace, pantryPurchase } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { knownTags, setTags, tagsFor } from '../pantry-allergies.ts'
import { heartsFor, purchasesFor, withHeartsAndTicks } from '../pantry-hearts.ts'
import { knownPlacements, placesFor, setPlaces } from '../pantry-places.ts'
import { openEventNow } from './events.ts'

export interface PantryDeps extends GuardDeps {
  now: () => Date
}

const asker = alias(account, 'asker')

const columns = {
  id: pantryItem.id,
  kind: pantryItem.kind,
  name: pantryItem.name,
  unit: pantryItem.unit,
  stock_level: pantryItem.stock_level,
  stock_amount: pantryItem.stock_amount,
  counted_by: pantryItem.counted_by,
  counted_by_name: account.name,
  counted_at: pantryItem.counted_at,
  need_more_by: pantryItem.need_more_by,
  need_more_by_name: asker.name,
  need_more_at: pantryItem.need_more_at,
  withdrawn_at: pantryItem.withdrawn_at,
  created_at: pantryItem.created_at,
}

const byName = sql`lower(trim(${pantryItem.name}))`

const listing = (db: Database) =>
  db
    .select(columns)
    .from(pantryItem)
    .leftJoin(account, eq(account.id, pantryItem.counted_by))
    .leftJoin(asker, eq(asker.id, pantryItem.need_more_by))

type Bare = Awaited<ReturnType<typeof listing>>[number]

const withTags = (
  rows: readonly Bare[],
  tags: ReadonlyMap<string, AllergyTag[]>,
  places: ReadonlyMap<string, PantryPlacing[]>,
): PantryItem[] =>
  rows.map(({ need_more_by, need_more_by_name, need_more_at, ...row }) => ({
    ...row,
    need_more:
      need_more_at === null ? null : { by: need_more_by, by_name: need_more_by_name, at: need_more_at },
    allergies: tags.get(row.id) ?? [],
    places: places.get(row.id) ?? [],
  }))

const listed = async (db: Database, rows: Promise<Bare[]>): Promise<PantryItem[]> =>
  withTags(...(await Promise.all([rows, tagsFor(db), placesFor(db)])))

export const pantryFor = (db: Database): Promise<PantryItem[]> => listed(db, listing(db).orderBy(byName))

const livePantry = (db: Database): Promise<PantryItem[]> =>
  listed(db, listing(db).where(isNull(pantryItem.withdrawn_at)).orderBy(byName))

const oneItem = async (db: Database, id: string): Promise<PantryItem | undefined> => {
  const [row] = await listing(db).where(eq(pantryItem.id, id)).limit(1)
  if (row === undefined) return undefined

  const [item] = withTags([row], await tagsFor(db, [row.id]), await placesFor(db, [row.id]))

  return item
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

  app.get<{ Params: { eventId: string } }>(
    apiRoutes.getEventPantry.fastify,
    guarded,
    async (request, reply) => {
      void noStore(reply)

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      const { eventId } = request.params
      const mine = await attendanceFor(db, eventId, viewer.account_id)

      const [items, hearts, bought] = await Promise.all([
        livePantry(db),
        heartsFor(db, eventId, mine),
        purchasesFor(db, eventId),
      ])

      return { items: withHeartsAndTicks(items, hearts, bought) } satisfies EventPantryResponse
    },
  )

  const onOpenBurn = async (
    request: FastifyRequest<{ Params: { eventId: string; itemId: string } }>,
    reply: FastifyReply,
  ): Promise<{ eventId: string; itemId: string; accountId: string } | undefined> => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) {
      void sendError(reply, 401)
      return undefined
    }

    const open = await openEventNow(db, now, request.params.eventId)
    const item = await oneItem(db, request.params.itemId)

    if (open === undefined || item === undefined || item.withdrawn_at !== null) {
      void sendError(reply, 404)
      return undefined
    }

    return { eventId: open.id, itemId: item.id, accountId: viewer.account_id }
  }

  app.put<{ Params: { eventId: string; itemId: string } }>(
    apiRoutes.heartPantryItem.fastify,
    guarded,
    async (request, reply) => {
      const on = await onOpenBurn(request, reply)
      if (on === undefined) return reply

      const mine = await attendanceFor(db, on.eventId, on.accountId)
      if (mine === undefined) return sendError(reply, 400, 'not_attending')

      await db.insert(pantryHeart).values({ item_id: on.itemId, attendance_id: mine }).onConflictDoNothing()

      return reply.code(204).send()
    },
  )

  app.delete<{ Params: { eventId: string; itemId: string } }>(
    apiRoutes.unheartPantryItem.fastify,
    guarded,
    async (request, reply) => {
      const on = await onOpenBurn(request, reply)
      if (on === undefined) return reply

      const mine = await attendanceFor(db, on.eventId, on.accountId)

      if (mine !== undefined) {
        await db
          .delete(pantryHeart)
          .where(and(eq(pantryHeart.item_id, on.itemId), eq(pantryHeart.attendance_id, mine)))
      }

      return reply.code(204).send()
    },
  )

  app.put<{ Params: { eventId: string; itemId: string } }>(
    apiRoutes.markPantryBought.fastify,
    guarded,
    async (request, reply) => {
      const on = await onOpenBurn(request, reply)
      if (on === undefined) return reply

      await db
        .insert(pantryPurchase)
        .values({
          event_id: on.eventId,
          item_id: on.itemId,
          bought_by: on.accountId,
          bought_at: now().toISOString(),
        })
        .onConflictDoNothing()

      await db
        .update(pantryItem)
        .set({ need_more_by: null, need_more_at: null })
        .where(eq(pantryItem.id, on.itemId))

      return reply.code(204).send()
    },
  )

  app.delete<{ Params: { eventId: string; itemId: string } }>(
    apiRoutes.unmarkPantryBought.fastify,
    guarded,
    async (request, reply) => {
      const on = await onOpenBurn(request, reply)
      if (on === undefined) return reply

      await db
        .delete(pantryPurchase)
        .where(and(eq(pantryPurchase.event_id, on.eventId), eq(pantryPurchase.item_id, on.itemId)))

      return reply.code(204).send()
    },
  )

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

  app.put<{ Params: { id: string } }>(
    apiRoutes.flagPantryNeedMore.fastify,
    guarded,
    async (request, reply) => {
      void noStore(reply)

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      const written = await db
        .update(pantryItem)
        .set({ need_more_by: viewer.account_id, need_more_at: now().toISOString() })
        .where(
          and(
            eq(pantryItem.id, request.params.id),
            isNull(pantryItem.withdrawn_at),
            isNull(pantryItem.need_more_at),
          ),
        )
        .returning({ id: pantryItem.id })

      if (written.length === 0) {
        const existing = await oneItem(db, request.params.id)

        if (existing === undefined || existing.withdrawn_at !== null) return sendError(reply, 404)
      }

      return reply.code(204).send()
    },
  )

  app.delete<{ Params: { id: string } }>(
    apiRoutes.unflagPantryNeedMore.fastify,
    guarded,
    async (request, reply) => {
      void noStore(reply)

      await db
        .update(pantryItem)
        .set({ need_more_by: null, need_more_at: null })
        .where(eq(pantryItem.id, request.params.id))

      return reply.code(204).send()
    },
  )

  app.put<{ Params: { id: string; placeId: string } }>(
    apiRoutes.putPantrySpot.fastify,
    guarded,
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(pantrySpotSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const { id, placeId } = request.params
      const item = await oneItem(db, id)
      if (item === undefined || item.withdrawn_at !== null) return sendError(reply, 404)

      const known = await knownPlacements(db, [{ place_id: placeId, spot: body.spot }])
      if (known === undefined) return sendError(reply, 404)

      await db
        .insert(pantryItemPlace)
        .values({ item_id: id, place_id: placeId, spot: body.spot })
        .onConflictDoUpdate({
          target: [pantryItemPlace.item_id, pantryItemPlace.place_id],
          set: { spot: body.spot },
        })

      return await answer(reply, id)
    },
  )

  app.delete<{ Params: { id: string; placeId: string } }>(
    apiRoutes.removePantrySpot.fastify,
    guarded,
    async (request, reply) => {
      void noStore(reply)

      const { id, placeId } = request.params

      await db
        .delete(pantryItemPlace)
        .where(and(eq(pantryItemPlace.item_id, id), eq(pantryItemPlace.place_id, placeId)))

      return reply.code(204).send()
    },
  )

  app.post(apiRoutes.addPantryItem.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(pantryCreateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const { allergy_item_ids, places, ...fields } = body
    const tags = await knownTags(db, allergy_item_ids)
    const placements = await knownPlacements(db, places)
    if (tags === undefined || placements === undefined) return sendError(reply, 400)
    if (await nameTaken(db, fields.name)) return sendError(reply, 409)

    const id = randomUUID()

    await db.insert(pantryItem).values({ ...fields, id, created_at: now().toISOString() })
    await setTags(db, id, tags)
    await setPlaces(db, id, placements)

    const item = await oneItem(db, id)
    if (item === undefined) return sendError(reply, 404)

    return reply.code(201).send({ item } satisfies PantryItemResponse)
  })

  app.patch<{ Params: { id: string } }>(apiRoutes.updatePantryItem.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(pantryUpdateSchema, request)
    if (body === undefined || isEmptyPatch(body)) return sendError(reply, 400)

    const { allergy_item_ids, places, ...fields } = body
    const tags = allergy_item_ids === undefined ? undefined : await knownTags(db, allergy_item_ids)
    if (allergy_item_ids !== undefined && tags === undefined) return sendError(reply, 400)

    const placements = places === undefined ? undefined : await knownPlacements(db, places)
    if (places !== undefined && placements === undefined) return sendError(reply, 400)

    const existing = await oneItem(db, request.params.id)
    if (existing === undefined) return sendError(reply, 404)

    if (fields.name !== undefined && (await nameTaken(db, fields.name, existing.id))) {
      return sendError(reply, 409)
    }

    if (!isEmptyPatch(fields)) await db.update(pantryItem).set(fields).where(eq(pantryItem.id, existing.id))
    if (tags !== undefined) await setTags(db, existing.id, tags)
    if (placements !== undefined) await setPlaces(db, existing.id, placements)

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
