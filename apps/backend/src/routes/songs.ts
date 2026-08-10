import type { Song, SongbookResponse, SongResponse, SongSummary, Thread, Viewer } from '@sage-burner/shared'
import type { FastifyInstance, FastifyReply } from 'fastify'

import { apiRoutes, songCreateSchema, songPage, songUpdateSchema } from '@sage-burner/shared'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'
import type { Notifier } from '../push/notify.ts'

import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { song, songCategory, songInCategory, thread } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { refuseIfStale, withCollectionVersion } from '../if-match.ts'
import { displayName, tellApproved } from '../push/notify.ts'
import { addEntry, readThreads, threadFor } from './threads.ts'

export interface SongDeps extends GuardDeps {
  now: () => Date
  notify?: Notifier
}

const filedUnder = async (db: Database, songIds: readonly string[]): Promise<Map<string, string[]>> => {
  if (songIds.length === 0) return new Map()

  const rows = await db
    .select({ song_id: songInCategory.song_id, category_id: songInCategory.category_id })
    .from(songInCategory)
    .innerJoin(songCategory, eq(songCategory.id, songInCategory.category_id))
    .where(inArray(songInCategory.song_id, [...songIds]))
    .orderBy(asc(songCategory.order), asc(songCategory.id))

  const held = new Map<string, string[]>()
  for (const row of rows) held.set(row.song_id, [...(held.get(row.song_id) ?? []), row.category_id])

  return held
}

export const categoriesFor = (db: Database) =>
  db.select().from(songCategory).orderBy(asc(songCategory.order), asc(songCategory.id))

export const songbookFor = async (db: Database): Promise<SongbookResponse> => {
  const rows = await db
    .select({
      id: song.id,
      title: song.title,
      capo: song.capo,
      links: song.links,
      author_account_id: song.author_account_id,
      deleted_at: song.deleted_at,
      created_at: song.created_at,
    })
    .from(song)
    .orderBy(asc(song.title), asc(song.id))

  const filed = await filedUnder(
    db,
    rows.map((row) => row.id),
  )

  return {
    songs: rows.map((row) => ({ ...row, category_ids: filed.get(row.id) ?? [] }) satisfies SongSummary),
    categories: await categoriesFor(db),
  }
}

export const songWith = async (db: Database, id: string): Promise<Song | undefined> => {
  const [row] = await db.select().from(song).where(eq(song.id, id)).limit(1)
  if (row === undefined) return undefined

  const filed = await filedUnder(db, [id])

  return { ...row, category_ids: filed.get(id) ?? [] }
}

const allCurated = async (db: Database, categoryIds: readonly string[]): Promise<boolean> => {
  const wanted = [...new Set(categoryIds)]
  if (wanted.length === 0) return true

  const rows = await db
    .select({ id: songCategory.id })
    .from(songCategory)
    .where(inArray(songCategory.id, wanted))

  return rows.length === wanted.length
}

const refile = (db: Database, songId: string, categoryIds: readonly string[]) =>
  db.transaction((tx) => {
    tx.delete(songInCategory).where(eq(songInCategory.song_id, songId)).run()

    for (const category_id of new Set(categoryIds)) {
      tx.insert(songInCategory).values({ song_id: songId, category_id }).run()
    }
  })

const WORDING = {
  title: 'gave it another name',
  body: 'worked on the words',
  capo: 'said where the capo goes',
  links: 'added somewhere to hear it',
  category_ids: 'filed it differently',
} as const

const whatChanged = (before: Song, after: Song): string => {
  const same: Record<keyof typeof WORDING, boolean> = {
    title: before.title === after.title,
    body: before.body === after.body,
    capo: before.capo === after.capo,
    links: JSON.stringify(before.links) === JSON.stringify(after.links),
    category_ids: JSON.stringify(before.category_ids) === JSON.stringify(after.category_ids),
  }

  const [first] = (Object.keys(WORDING) as (keyof typeof WORDING)[]).filter((field) => !same[field])

  return first === undefined ? 'went over it' : WORDING[first]
}

export const registerSongRoutes = (
  app: FastifyInstance,
  { db, sessions, now, notify = async () => undefined }: SongDeps,
) => {
  const { requireApproved } = createGuards({ db, sessions })

  const guarded = { preHandler: requireApproved }

  const threadForSong = async (one: { id: string; title: string }): Promise<string> =>
    await threadFor(db, 'song', { id: one.id, event_id: null, title: one.title })

  // Read-only, unlike `threadFor`: a GET must not write a thread for a song that has none.
  const talkAbout = async (songId: string, viewer: Viewer | undefined): Promise<Thread | null> => {
    const [row] = await db
      .select({ id: thread.id })
      .from(thread)
      .where(and(eq(thread.entity_type, 'song'), eq(thread.entity_id, songId)))
      .limit(1)

    if (row === undefined) return null

    return (await readThreads(db, [row.id], { viewer }))[0] ?? null
  }

  // The version covers the song alone: a comment must not make somebody's open editor stale.
  const answer = async (reply: FastifyReply, one: Song, viewer: Viewer | undefined) =>
    await withCollectionVersion(
      reply,
      { song: one, thread: await talkAbout(one.id, viewer) } satisfies SongResponse,
      async () => ({ song: one }),
    )

  app.get(apiRoutes.getSongbook.fastify, guarded, async (_request, reply) => {
    void noStore(reply)

    return await songbookFor(db)
  })

  app.get<{ Params: { id: string } }>(apiRoutes.getSong.fastify, guarded, async (request, reply) => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    const found = await songWith(db, request.params.id)
    if (found === undefined) return sendError(reply, 404)

    return await answer(reply, found, viewer)
  })

  app.post(apiRoutes.addSong.fastify, guarded, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(songCreateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    if (!(await allCurated(db, body.category_ids))) return sendError(reply, 400)

    const row = {
      id: randomUUID(),
      title: body.title,
      body: body.body,
      capo: body.capo,
      links: body.links,
      author_account_id: viewer.account_id,
      deleted_at: null,
      created_at: now().toISOString(),
    }

    await db.insert(song).values(row)
    refile(db, row.id, body.category_ids)

    const added = { ...row, category_ids: body.category_ids } satisfies Song

    await addEntry(
      db,
      {
        thread_id: await threadForSong(added),
        kind: 'added',
        author_account_id: viewer.account_id,
        body: 'put it in the book',
      },
      now(),
    )

    const who = await displayName(db, viewer.account_id)

    await tellApproved(
      db,
      notify,
      { category: 'song_added', body: `${who} added a song: ${added.title}`, link: songPage(added.id) },
      { except: [viewer.account_id] },
    )

    return reply.code(201).send(await answer(reply, added, viewer))
  })

  app.patch<{ Params: { id: string } }>(apiRoutes.updateSong.fastify, guarded, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(songUpdateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    const existing = await songWith(db, request.params.id)
    if (existing === undefined || existing.deleted_at !== null) return sendError(reply, 404)
    if (Object.keys(body).length === 0) return await answer(reply, existing, viewer)

    if (await refuseIfStale(request, reply, async () => ({ song: existing }))) return reply

    const { category_ids, ...columns } = body

    if (category_ids !== undefined && !(await allCurated(db, category_ids))) return sendError(reply, 400)

    if (Object.keys(columns).length > 0) {
      await db.update(song).set(columns).where(eq(song.id, existing.id))
    }
    if (category_ids !== undefined) refile(db, existing.id, category_ids)

    const after = await songWith(db, existing.id)
    if (after === undefined) return sendError(reply, 404)

    await addEntry(
      db,
      {
        thread_id: await threadForSong(after),
        kind: 'edited',
        author_account_id: viewer.account_id,
        body: whatChanged(existing, after),
      },
      now(),
    )

    return await answer(reply, after, viewer)
  })

  app.delete<{ Params: { id: string } }>(apiRoutes.deleteSong.fastify, guarded, async (request, reply) => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    const [existing] = await db.select().from(song).where(eq(song.id, request.params.id)).limit(1)
    if (existing === undefined) return sendError(reply, 404)

    if (existing.deleted_at === null) {
      await db.update(song).set({ deleted_at: now().toISOString() }).where(eq(song.id, existing.id))

      await addEntry(
        db,
        {
          thread_id: await threadForSong(existing),
          kind: 'withdrawn',
          author_account_id: viewer.account_id,
          body: 'took it out of the book',
        },
        now(),
      )
    }

    return reply.code(204).send()
  })

  app.post<{ Params: { id: string } }>(apiRoutes.restoreSong.fastify, guarded, async (request, reply) => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    const [existing] = await db.select().from(song).where(eq(song.id, request.params.id)).limit(1)
    if (existing === undefined) return sendError(reply, 404)

    if (existing.deleted_at !== null) {
      await db.update(song).set({ deleted_at: null }).where(eq(song.id, existing.id))

      await addEntry(
        db,
        {
          thread_id: await threadForSong(existing),
          kind: 'restored',
          author_account_id: viewer.account_id,
          body: 'put it back in the book',
        },
        now(),
      )
    }

    const after = await songWith(db, existing.id)
    if (after === undefined) return sendError(reply, 404)

    return await answer(reply, after, viewer)
  })
}
