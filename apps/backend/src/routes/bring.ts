import type {
  BringEntry,
  BringItem,
  BringListResponse,
  BringResponse,
  ThreadEntryKind,
} from '@sage-burner/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'

import { apiRoutes, bringCreateSchema, bringPage, bringUpdateSchema, helperSchema } from '@sage-burner/shared'
import { and, asc, eq, gte, isNull } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'
import type { Notifier } from '../push/notify.ts'

import { attendanceFor } from '../attendances.ts'
import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { handsFor, handsOn } from '../bring-hands.ts'
import { isEmptyPatch, patchRow } from '../db/patch.ts'
import { account, bringHand, bringItem, event, thread } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { displayName, namedBy, oneBatch, reachedByMention, tellAttendees } from '../push/notify.ts'
import { openEventNow, todayIso } from './events.ts'
import { addEntry, threadFor, threadIdFor } from './threads.ts'

export interface BringDeps extends GuardDeps {
  now: () => Date
  notify?: Notifier
}

type Listed = Omit<BringEntry, 'hands'>

const withHands = async (db: Database, rows: readonly Listed[]): Promise<BringEntry[]> => {
  const hands = await handsFor(
    db,
    rows.map((row) => row.id),
  )

  return rows.map((row) => ({ ...row, hands: hands.get(row.id) ?? [] }) satisfies BringEntry)
}

const columns = {
  id: bringItem.id,
  event_id: bringItem.event_id,
  author_account_id: bringItem.author_account_id,
  author_name: account.name,
  title: bringItem.title,
  comment: bringItem.comment,
  withdrawn_at: bringItem.withdrawn_at,
  created_at: bringItem.created_at,
  thread_id: thread.id,
}

const listing = (db: Database) =>
  db
    .select(columns)
    .from(bringItem)
    .leftJoin(account, eq(account.id, bringItem.author_account_id))
    .leftJoin(thread, and(eq(thread.entity_type, 'bring'), eq(thread.entity_id, bringItem.id)))

const bringListFor = async (db: Database, eventId: string): Promise<BringEntry[]> =>
  await withHands(
    db,
    await listing(db)
      .where(and(eq(bringItem.event_id, eventId), isNull(bringItem.withdrawn_at)))
      .orderBy(asc(bringItem.created_at), asc(bringItem.id)),
  )

const oneItem = async (db: Database, id: string): Promise<BringEntry | undefined> => {
  const [row] = await listing(db).where(eq(bringItem.id, id)).limit(1)
  if (row === undefined) return undefined

  const [answered] = await withHands(db, [row])

  return answered
}

const onOpenBurn = async (db: Database, now: () => Date, id: string): Promise<BringItem | undefined> => {
  const [row] = await db
    .select()
    .from(bringItem)
    .innerJoin(event, eq(bringItem.event_id, event.id))
    .where(and(eq(bringItem.id, id), gte(event.end_date, todayIso(now))))
    .limit(1)

  return row?.bring_item
}

export const registerBringRoutes = (
  app: FastifyInstance,
  { db, sessions, now, notify = async () => undefined }: BringDeps,
) => {
  const { requireApproved } = createGuards({ db, sessions })

  const guarded = { preHandler: requireApproved }

  const noteOnItem = async (
    item: BringItem,
    body: string,
    by: string | undefined,
    kind: ThreadEntryKind = 'helper',
    talkedOn?: string,
  ) =>
    await addEntry(
      db,
      {
        thread_id: talkedOn ?? (await threadFor(db, 'bring', item)),
        kind,
        author_account_id: by ?? null,
        body,
      },
      now(),
    )

  const tell = async (by: string | undefined, accountId: string, item: BringItem, message: string) => {
    if (accountId === by) return

    await notify(accountId, {
      category: 'bring_role',
      body: message,
      link: bringPage(item.event_id, item.id),
    })
  }

  const tellNamed = async (named: readonly string[], who: string, item: BringItem) => {
    const said = oneBatch({
      category: 'mentioned',
      body: `${who} named you about: ${item.title}`,
      link: bringPage(item.event_id, item.id),
    })

    await Promise.all(named.map(async (accountId) => await notify(accountId, said)))
  }

  const found = async (
    request: FastifyRequest<{ Params: { id: string } }>,
  ): Promise<{ item: BringItem; callerId: string | undefined } | undefined> => {
    const item = await onOpenBurn(db, now, request.params.id)
    if (item === undefined || item.withdrawn_at !== null) return undefined

    const viewer = await viewerFor(request, { db, sessions })

    return { item, callerId: viewer?.account_id }
  }

  app.get<{ Params: { eventId: string } }>(
    apiRoutes.getBringList.fastify,
    guarded,
    async (request, reply) => {
      void noStore(reply)

      return { items: await bringListFor(db, request.params.eventId) } satisfies BringListResponse
    },
  )

  app.post<{ Params: { eventId: string } }>(
    apiRoutes.addBringItem.fastify,
    guarded,
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(bringCreateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      const open = await openEventNow(db, now, request.params.eventId)
      if (open === undefined) return sendError(reply, 404)

      const mine = await attendanceFor(db, open.id, viewer.account_id)
      if (body.bringing && mine === undefined) return sendError(reply, 400, 'not_attending')

      const row = {
        id: randomUUID(),
        event_id: open.id,
        author_account_id: viewer.account_id,
        title: body.title,
        comment: body.comment,
        withdrawn_at: null,
        created_at: now().toISOString(),
      } satisfies BringItem

      const threadId = db.transaction((tx) => {
        tx.insert(bringItem).values(row).run()

        if (body.bringing && mine !== undefined) {
          tx.insert(bringHand).values({ item_id: row.id, attendance_id: mine }).run()
        }

        return threadIdFor(tx, { type: 'bring', id: row.id, event_id: row.event_id, title: row.title })
      })

      await noteOnItem(
        row,
        body.bringing ? 'is bringing this' : 'asked for this',
        viewer.account_id,
        'added',
        threadId,
      )

      const who = await displayName(db, viewer.account_id)
      const named = await reachedByMention(
        db,
        await namedBy(db, row.comment, row.event_id, viewer.account_id),
      )

      await tellNamed(named, who, row)

      await tellAttendees(
        db,
        notify,
        row.event_id,
        {
          category: 'bring_added',
          body: body.bringing ? `${who} is bringing: ${row.title}` : `${who} asked for: ${row.title}`,
          link: bringPage(row.event_id, row.id),
        },
        { except: [viewer.account_id, ...named] },
      )

      const answered = await oneItem(db, row.id)
      if (answered === undefined) return sendError(reply, 404)

      return reply.code(201).send({ item: answered } satisfies BringResponse)
    },
  )

  app.patch<{ Params: { id: string } }>(
    apiRoutes.updateBringItem.fastify,
    guarded,
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(bringUpdateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      const existing = await onOpenBurn(db, now, request.params.id)
      if (existing === undefined || existing.withdrawn_at !== null) return sendError(reply, 404)
      if (existing.author_account_id !== viewer.account_id) return sendError(reply, 403)

      if (!isEmptyPatch(body)) {
        const patched = await patchRow(db, bringItem, eq(bringItem.id, existing.id), body)
        if (patched.kind !== 'ok') return sendError(reply, 404)

        const reworded = patched.row.title !== existing.title || patched.row.comment !== existing.comment

        if (reworded) await noteOnItem(patched.row, 'went over it', viewer.account_id, 'edited')

        const already = new Set(await namedBy(db, existing.comment, existing.event_id, viewer.account_id))
        const newly = (
          await reachedByMention(
            db,
            await namedBy(db, patched.row.comment, existing.event_id, viewer.account_id),
          )
        ).filter((accountId) => !already.has(accountId))

        await tellNamed(newly, await displayName(db, viewer.account_id), patched.row)
      }

      const answered = await oneItem(db, existing.id)
      if (answered === undefined) return sendError(reply, 404)

      return { item: answered } satisfies BringResponse
    },
  )

  app.delete<{ Params: { id: string } }>(
    apiRoutes.deleteBringItem.fastify,
    guarded,
    async (request, reply) => {
      void noStore(reply)

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      const existing = await onOpenBurn(db, now, request.params.id)
      if (existing === undefined) return sendError(reply, 404)

      const mine = existing.author_account_id === viewer.account_id
      if (!mine && !viewer.roles.includes('admin')) return sendError(reply, 403)

      if (existing.withdrawn_at === null) {
        await db
          .update(bringItem)
          .set({ withdrawn_at: now().toISOString() })
          .where(eq(bringItem.id, existing.id))

        await noteOnItem(existing, 'took it off the list', viewer.account_id, 'withdrawn')
      }

      return reply.code(204).send()
    },
  )

  app.post<{ Params: { id: string } }>(apiRoutes.bringThis.fastify, guarded, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(helperSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const on = await found(request)
    if (on === undefined) return sendError(reply, 404)

    const theirs = await attendanceFor(db, on.item.event_id, body.account_id)
    if (theirs === undefined) return sendError(reply, 400, 'not_attending')

    const asked = (await handsOn(db, on.item.id)).length === 0

    const added = await db
      .insert(bringHand)
      .values({ item_id: on.item.id, attendance_id: theirs })
      .onConflictDoNothing()
      .returning()

    if (added.length > 0) {
      await tell(on.callerId, body.account_id, on.item, `You are bringing ${on.item.title}`)

      const asker = on.item.author_account_id
      if (asked && asker !== null && asker !== on.callerId && asker !== body.account_id) {
        await notify(asker, {
          category: 'bring_answered',
          body: `${await displayName(db, body.account_id)} is bringing ${on.item.title}`,
          link: bringPage(on.item.event_id, on.item.id),
        })
      }

      await noteOnItem(
        on.item,
        body.account_id === on.callerId
          ? 'is bringing this'
          : `asked ${await displayName(db, body.account_id)} to bring it`,
        on.callerId,
      )
    }

    const answered = await oneItem(db, on.item.id)
    if (answered === undefined) return sendError(reply, 404)

    return { item: answered } satisfies BringResponse
  })

  app.delete<{ Params: { id: string; accountId: string } }>(
    apiRoutes.stopBringingThis.fastify,
    guarded,
    async (request, reply) => {
      void noStore(reply)

      const on = await found(request)
      if (on === undefined) return sendError(reply, 404)

      const theirs = await attendanceFor(db, on.item.event_id, request.params.accountId)
      if (theirs === undefined) return sendError(reply, 400)

      const gone = await db
        .delete(bringHand)
        .where(and(eq(bringHand.item_id, on.item.id), eq(bringHand.attendance_id, theirs)))
        .returning()

      if (gone.length > 0) {
        await tell(
          on.callerId,
          request.params.accountId,
          on.item,
          `You are no longer bringing ${on.item.title}`,
        )

        await noteOnItem(
          on.item,
          request.params.accountId === on.callerId
            ? 'cannot bring it after all'
            : `took ${await displayName(db, request.params.accountId)} off bringing it`,
          on.callerId,
        )
      }

      const answered = await oneItem(db, on.item.id)
      if (answered === undefined) return sendError(reply, 404)

      return { item: answered } satisfies BringResponse
    },
  )
}
