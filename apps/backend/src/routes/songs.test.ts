import type { Song, SongbookResponse, Thread } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, song, songCategory, songInCategory } from '../db/schema.ts'

const SECRET = 'p'.repeat(40)
const NOW = '2026-07-02T00:00:00.000Z'

let handle: DbHandle | undefined
let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  handle?.close()
  app = undefined
  handle = undefined
})

const db = () => {
  const found = handle?.db
  if (found === undefined) throw new Error('build() first')
  return found
}

const build = async () => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: SECRET }),
    now: () => new Date(NOW),
  })
  return app
}

const givenAccount = async (name: string, roles: ('admin' | 'member')[] = ['member']) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, name, password_hash: null, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return { id, name, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
}

const add = (server: FastifyInstance, cookie: string, payload: Record<string, unknown>) =>
  server.inject({ method: 'POST', url: '/api/songs', headers: { cookie }, payload })

const book = async (server: FastifyInstance, cookie: string): Promise<SongbookResponse> =>
  (await server.inject({ method: 'GET', url: '/api/songs', headers: { cookie } })).json()

const read = (server: FastifyInstance, cookie: string, id: string) =>
  server.inject({ method: 'GET', url: `/api/songs/${id}`, headers: { cookie } })

const edit = async (
  server: FastifyInstance,
  cookie: string,
  id: string,
  payload: Record<string, unknown>,
) => {
  const held = await read(server, cookie, id)

  return await server.inject({
    method: 'PATCH',
    url: `/api/songs/${id}`,
    headers: { cookie, 'if-match': held.headers.etag ?? '' },
    payload,
  })
}

const remove = (server: FastifyInstance, cookie: string, id: string) =>
  server.inject({ method: 'DELETE', url: `/api/songs/${id}`, headers: { cookie } })

const restore = (server: FastifyInstance, cookie: string, id: string) =>
  server.inject({ method: 'POST', url: `/api/songs/${id}/restore`, headers: { cookie } })

const cards = async (server: FastifyInstance, cookie: string): Promise<Thread[]> =>
  (await server.inject({ method: 'GET', url: '/api/feed', headers: { cookie } })).json().threads

/** Read by id, which is how a card taken back is read at all: the feed drops it (#617). */
const cardOf = async (server: FastifyInstance, cookie: string, threadId: string): Promise<Thread> =>
  (await server.inject({ method: 'GET', url: `/api/threads/${threadId}`, headers: { cookie } })).json().thread

const bell = async (server: FastifyInstance, cookie: string): Promise<{ category: string; body: string }[]> =>
  (await server.inject({ method: 'GET', url: '/api/me/notifications', headers: { cookie } })).json()
    .notifications

const setOn = (server: FastifyInstance, cookie: string, on: string[]) =>
  server.inject({
    method: 'PUT',
    url: '/api/me/notification-settings',
    headers: { cookie },
    payload: { on, email: [] },
  })

const givenCategory = async (label: string, order: number) => {
  const id = randomUUID()
  await db().insert(songCategory).values({ id, order, label })

  return id
}

const CHORUS = 'Am      F\ncome and sing with me\nC       G'

describe('putting a song in the book', () => {
  it('needs only a title, and comes back with the rest empty', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')

    const made = await add(server, ada.cookie, { title: 'Fire in the sky' })

    expect(made.statusCode).toBe(201)
    const written: Song = made.json().song
    expect(written.title).toBe('Fire in the sky')
    expect(written.body).toBe('')
    expect(written.capo).toBeNull()
    expect(written.links).toEqual([])
    expect(written.category_ids).toEqual([])
    expect(written.author_account_id).toBe(ada.id)
  })

  it('comes back with the conversation about it, so the page needs no second read', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')
    const made = await add(server, ada.cookie, { title: 'Fire in the sky' })

    const held = await read(server, ada.cookie, made.json().song.id)

    expect(held.json().thread.entries.map((entry: { kind: string }) => entry.kind)).toEqual(['added'])
  })

  it('keeps the words as authored, whitespace and all', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')

    const made = await add(server, ada.cookie, { title: 'Fire in the sky', body: CHORUS })

    const held = await read(server, ada.cookie, made.json().song.id)
    expect(held.json().song.body).toBe(CHORUS)
  })

  it('is any approved member’s, and refused to somebody with no role', async () => {
    const server = await build()
    const nobody = await givenAccount('Nobody', [])
    const organiser = await givenAccount('Org', ['admin'])

    expect((await add(server, nobody.cookie, { title: 'Fire' })).statusCode).toBe(403)
    expect((await add(server, organiser.cookie, { title: 'Fire' })).statusCode).toBe(201)
  })

  it('files it under categories from the curated list', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')
    const chant = await givenCategory('Chant', 10)

    const made = await add(server, ada.cookie, { title: 'Fire', category_ids: [chant] })

    expect(made.json().song.category_ids).toEqual([chant])
  })

  it('refuses a category nobody curated, and writes no song either', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')

    const made = await add(server, ada.cookie, {
      title: 'Fire',
      category_ids: ['c0000000-0000-4000-8000-000000000001'],
    })

    expect(made.statusCode).toBe(400)
    expect((await book(server, ada.cookie)).songs).toEqual([])
  })

  it('refuses a link that is not an https address', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')

    const made = await add(server, ada.cookie, {
      title: 'Fire',
      links: [{ url: 'javascript:alert(1)' }],
    })

    expect(made.statusCode).toBe(400)
  })

  it('takes a link that is one', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')

    const made = await add(server, ada.cookie, {
      title: 'Fire',
      links: [{ url: 'https://open.spotify.com/track/1' }],
    })

    expect(made.statusCode).toBe(201)
    expect(made.json().song.links).toEqual([{ url: 'https://open.spotify.com/track/1' }])
  })

  it('refuses a name for a link, which nothing shows any more', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')

    const made = await add(server, ada.cookie, {
      title: 'Fire',
      links: [{ url: 'https://open.spotify.com/track/1', label: 'The 1972 one' }],
    })

    expect(made.statusCode).toBe(400)
  })

  it('takes whose song it is, and answers null where nobody has said', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')

    const named = await add(server, ada.cookie, { title: 'Fire', artist: 'Tracy Chapman' })
    const nameless = await add(server, ada.cookie, { title: 'Ashes' })

    expect(named.json().song.artist).toBe('Tracy Chapman')
    expect(nameless.json().song.artist).toBeNull()
  })

  it('refuses a blank artist, null being how nothing said is spelled', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')

    expect((await add(server, ada.cookie, { title: 'Fire', artist: '   ' })).statusCode).toBe(400)
    expect((await add(server, ada.cookie, { title: 'Fire', artist: null })).statusCode).toBe(201)
  })

  it('refuses a capo off the neck', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')

    expect((await add(server, ada.cookie, { title: 'Fire', capo: 12 })).statusCode).toBe(400)
    expect((await add(server, ada.cookie, { title: 'Fire', capo: -1 })).statusCode).toBe(400)
    expect((await add(server, ada.cookie, { title: 'Fire', capo: 11 })).statusCode).toBe(201)
  })
})

describe('the book itself', () => {
  it('is alphabetical, and leaves the words out of the list', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')
    await add(server, ada.cookie, { title: 'Zephyr', body: CHORUS })
    await add(server, ada.cookie, { title: 'Ashes', body: CHORUS })

    const listed = await book(server, ada.cookie)

    expect(listed.songs.map((one) => one.title)).toEqual(['Ashes', 'Zephyr'])
    expect(listed.songs.every((one) => !('body' in one))).toBe(true)
  })

  it('carries the curated categories beside the songs, in their order', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')

    expect((await book(server, ada.cookie)).categories.map((one) => one.label)).toEqual(['Chant', 'Song'])
  })

  it('is not readable by somebody with no role', async () => {
    const server = await build()
    const nobody = await givenAccount('Nobody', [])

    expect(
      (await server.inject({ method: 'GET', url: '/api/songs', headers: { cookie: nobody.cookie } }))
        .statusCode,
    ).toBe(403)
  })
})

describe('editing a song', () => {
  it('is any member’s, not only whoever put it in', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')
    const bo = await givenAccount('Bo')
    const made = await add(server, ada.cookie, { title: 'Fire' })

    const saved = await edit(server, bo.cookie, made.json().song.id, { body: CHORUS })

    expect(saved.statusCode).toBe(200)
    expect(saved.json().song.body).toBe(CHORUS)
  })

  it('says whose song it is on the list as well, so it can be sorted on', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')
    await add(server, ada.cookie, { title: 'Fire', artist: 'Tracy Chapman' })

    const [listed] = (await book(server, ada.cookie)).songs

    expect(listed?.artist).toBe('Tracy Chapman')
  })

  it('takes an artist off again, which is what a blank field means', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')
    const made = await add(server, ada.cookie, { title: 'Fire', artist: 'Tracy Chapman' })

    const saved = await edit(server, ada.cookie, made.json().song.id, { artist: null })

    expect(saved.statusCode).toBe(200)
    expect(saved.json().song.artist).toBeNull()
  })

  it('says on the card that somebody named the artist, not that they renamed it', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')
    const made = await add(server, ada.cookie, { title: 'Fire' })

    await edit(server, ada.cookie, made.json().song.id, { artist: 'Tracy Chapman' })

    const { thread } = (await read(server, ada.cookie, made.json().song.id)).json()
    expect(thread.entries.at(-1).body).toBe('said whose song it is')
  })

  it('refuses a write held against a version somebody else has moved past', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')
    const bo = await givenAccount('Bo')
    const id = (await add(server, ada.cookie, { title: 'Fire' })).json().song.id
    const held = await read(server, ada.cookie, id)

    await edit(server, bo.cookie, id, { title: 'Fire in the sky' })

    const late = await server.inject({
      method: 'PATCH',
      url: `/api/songs/${id}`,
      headers: { cookie: ada.cookie, 'if-match': held.headers.etag ?? '' },
      payload: { title: 'Fire on the water' },
    })

    expect(late.statusCode).toBe(412)
    expect((await read(server, ada.cookie, id)).json().song.title).toBe('Fire in the sky')
  })

  it('is not made stale by somebody commenting, since the version covers the song', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')
    const bo = await givenAccount('Bo')
    const id = (await add(server, ada.cookie, { title: 'Fire' })).json().song.id
    const held = await read(server, ada.cookie, id)

    await server.inject({
      method: 'POST',
      url: `/api/threads/${held.json().thread.id}/comments`,
      headers: { cookie: bo.cookie },
      payload: { body: 'we sang this at dawn' },
    })

    const saved = await server.inject({
      method: 'PATCH',
      url: `/api/songs/${id}`,
      headers: { cookie: ada.cookie, 'if-match': held.headers.etag ?? '' },
      payload: { title: 'Fire in the sky' },
    })

    expect(saved.statusCode).toBe(200)
  })

  it('asks for a version when the write carries none', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')
    const id = (await add(server, ada.cookie, { title: 'Fire' })).json().song.id

    const bare = await server.inject({
      method: 'PATCH',
      url: `/api/songs/${id}`,
      headers: { cookie: ada.cookie },
      payload: { title: 'Fire in the sky' },
    })

    expect(bare.statusCode).toBe(428)
  })

  it('refiles it, replacing what it was under rather than adding', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')
    const chant = await givenCategory('Chant list', 10)
    const round = await givenCategory('Round', 11)
    const id = (await add(server, ada.cookie, { title: 'Fire', category_ids: [chant] })).json().song.id

    const saved = await edit(server, ada.cookie, id, { category_ids: [round] })

    expect(saved.json().song.category_ids).toEqual([round])
  })

  it('will not edit one that has been taken out of the book', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')
    const id = (await add(server, ada.cookie, { title: 'Fire' })).json().song.id
    await remove(server, ada.cookie, id)

    expect((await edit(server, ada.cookie, id, { title: 'Fire again' })).statusCode).toBe(404)
  })
})

describe('taking a song out, and putting it back', () => {
  it('leaves the row and hides it from the living half of the book', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')
    const id = (await add(server, ada.cookie, { title: 'Fire' })).json().song.id

    expect((await remove(server, ada.cookie, id)).statusCode).toBe(204)

    const listed = await book(server, ada.cookie)
    expect(listed.songs.map((one) => one.deleted_at)).toEqual([NOW])
  })

  it('is any member’s, whoever put it in', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')
    const bo = await givenAccount('Bo')
    const id = (await add(server, ada.cookie, { title: 'Fire' })).json().song.id

    expect((await remove(server, bo.cookie, id)).statusCode).toBe(204)
  })

  it('can be undone, and the words are still there', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')
    const id = (await add(server, ada.cookie, { title: 'Fire', body: CHORUS })).json().song.id
    await remove(server, ada.cookie, id)

    const back = await restore(server, ada.cookie, id)

    expect(back.statusCode).toBe(200)
    expect(back.json().song.deleted_at).toBeNull()
    expect(back.json().song.body).toBe(CHORUS)
  })

  it('says so twice over without adding a second line', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')
    const id = (await add(server, ada.cookie, { title: 'Fire' })).json().song.id
    const [before] = await cards(server, ada.cookie)
    await remove(server, ada.cookie, id)
    await remove(server, ada.cookie, id)

    const card = await cardOf(server, ada.cookie, before?.id ?? '')
    expect(card.entries.filter((entry) => entry.kind === 'withdrawn')).toHaveLength(1)
  })

  it('takes the filing with it when the whole row goes', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')
    const chant = await givenCategory('Chant list', 10)
    const id = (await add(server, ada.cookie, { title: 'Fire', category_ids: [chant] })).json().song.id

    await db().delete(song).where(eq(song.id, id))

    expect(await db().select().from(songInCategory)).toEqual([])
  })
})

describe('a song on the feed', () => {
  it('opens a card that belongs to no burn', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')
    const made = await add(server, ada.cookie, { title: 'Fire in the sky' })

    const [card] = await cards(server, ada.cookie)

    expect(card?.entity_type).toBe('song')
    expect(card?.event_id).toBeNull()
    expect(card?.burn).toBeNull()
    expect(card?.title).toBe('Fire in the sky')
    expect(card?.link).toBe(`/songs/${made.json().song.id}`)
    expect(card?.entries.map((entry) => [entry.kind, entry.author?.name])).toEqual([['added', 'Ada']])
  })

  it('heads with the title as it is now, not as it was written', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')
    const id = (await add(server, ada.cookie, { title: 'Fire' })).json().song.id

    await edit(server, ada.cookie, id, { title: 'Fire in the sky' })

    const [card] = await cards(server, ada.cookie)
    expect(card?.title).toBe('Fire in the sky')
  })

  it('coalesces one author’s polishing into one line that keeps bumping', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')
    const id = (await add(server, ada.cookie, { title: 'Fire' })).json().song.id

    await edit(server, ada.cookie, id, { body: 'Am' })
    await edit(server, ada.cookie, id, { body: 'Am F' })
    await edit(server, ada.cookie, id, { body: CHORUS })

    const [card] = await cards(server, ada.cookie)
    expect(card?.entries.filter((entry) => entry.kind === 'edited')).toHaveLength(1)
  })

  it('goes off the page when it is taken out, and comes back with it', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')
    const id = (await add(server, ada.cookie, { title: 'Fire' })).json().song.id
    const [before] = await cards(server, ada.cookie)

    await remove(server, ada.cookie, id)
    expect(await cards(server, ada.cookie)).toEqual([])
    expect((await cardOf(server, ada.cookie, before?.id ?? '')).gone).toBe(true)

    await restore(server, ada.cookie, id)
    const back = (await cards(server, ada.cookie))[0]
    expect(back?.gone).toBe(false)
    expect(back?.entries.map((entry) => entry.kind)).toEqual(['added', 'withdrawn', 'restored'])
  })

  it('is commentable, and a comment names the song rather than a burn', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')
    const bo = await givenAccount('Bo')
    const id = (await add(server, ada.cookie, { title: 'Fire in the sky' })).json().song.id
    const [card] = await cards(server, ada.cookie)

    const said = await server.inject({
      method: 'POST',
      url: `/api/threads/${card?.id ?? ''}/comments`,
      headers: { cookie: bo.cookie },
      payload: { body: 'we sang this at dawn' },
    })

    expect(said.statusCode).toBe(200)
    expect(await bell(server, ada.cookie)).toEqual([
      {
        category: 'song_comment',
        body: 'Bo said something about Fire in the sky',
        link: `/songs/${id}`,
        created_at: NOW,
        id: expect.any(String),
        seen_at: null,
      },
    ])
  })
})

describe('being told about the book', () => {
  it('reaches every approved account that asked, whatever burn they are at', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')
    const bo = await givenAccount('Bo')
    await setOn(server, bo.cookie, ['song_added'])

    await add(server, ada.cookie, { title: 'Fire in the sky' })

    expect((await bell(server, bo.cookie)).map((one) => [one.category, one.body])).toEqual([
      ['song_added', 'Ada added a song: Fire in the sky'],
    ])
  })

  it('is off until somebody asks for it', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')
    const bo = await givenAccount('Bo')

    await add(server, ada.cookie, { title: 'Fire in the sky' })

    expect(await bell(server, bo.cookie)).toEqual([])
  })

  it('never tells whoever put it in', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')
    await setOn(server, ada.cookie, ['song_added'])

    await add(server, ada.cookie, { title: 'Fire in the sky' })

    expect(await bell(server, ada.cookie)).toEqual([])
  })

  it('says nothing to an account holding no role', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')
    const nobody = await givenAccount('Nobody', [])
    await db().insert(accountRole).values({ account_id: nobody.id, role: 'member' })
    await setOn(server, nobody.cookie, ['song_added'])
    await db().delete(accountRole).where(eq(accountRole.account_id, nobody.id))

    await add(server, ada.cookie, { title: 'Fire in the sky' })

    expect(await bell(server, nobody.cookie)).toEqual([])
  })

  it('says nothing on an edit, since the bell is for the insert', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')
    const bo = await givenAccount('Bo')
    await setOn(server, bo.cookie, ['song_added'])
    const id = (await add(server, ada.cookie, { title: 'Fire' })).json().song.id

    await edit(server, ada.cookie, id, { body: CHORUS })

    expect(await bell(server, bo.cookie)).toHaveLength(1)
  })
})

describe('the curated category list', () => {
  it('is admin’s to change, and any member’s to read', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')
    const organiser = await givenAccount('Org', ['admin'])

    const refused = await server.inject({
      method: 'POST',
      url: '/api/admin/song-categories',
      headers: { cookie: ada.cookie },
      payload: { label: 'Round' },
    })
    expect(refused.statusCode).toBe(403)

    const made = await server.inject({
      method: 'POST',
      url: '/api/admin/song-categories',
      headers: { cookie: organiser.cookie },
      payload: { label: 'Round' },
    })
    expect(made.statusCode).toBe(201)

    const listed = await server.inject({
      method: 'GET',
      url: '/api/song-categories',
      headers: { cookie: ada.cookie },
    })
    expect(listed.json().categories.map((one: { label: string }) => one.label)).toEqual([
      'Chant',
      'Song',
      'Round',
    ])
  })

  it('unfiles the songs in a category that is taken off the list', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')
    const organiser = await givenAccount('Org', ['admin'])
    const round = await givenCategory('Round', 10)
    const id = (await add(server, ada.cookie, { title: 'Fire', category_ids: [round] })).json().song.id

    const gone = await server.inject({
      method: 'DELETE',
      url: `/api/admin/song-categories/${round}`,
      headers: { cookie: organiser.cookie },
    })

    expect(gone.statusCode).toBe(204)
    expect((await read(server, ada.cookie, id)).json().song.category_ids).toEqual([])
  })

  it('renames one, and every song filed under it says the new name', async () => {
    const server = await build()
    const organiser = await givenAccount('Org', ['admin'])
    const round = await givenCategory('Rond', 10)

    const saved = await server.inject({
      method: 'PATCH',
      url: `/api/admin/song-categories/${round}`,
      headers: { cookie: organiser.cookie },
      payload: { label: 'Round' },
    })

    expect(saved.json().category.label).toBe('Round')
  })

  it('reorders the list, and refuses a list that is not the same set', async () => {
    const server = await build()
    const organiser = await givenAccount('Org', ['admin'])
    const listed = await server.inject({
      method: 'GET',
      url: '/api/song-categories',
      headers: { cookie: organiser.cookie },
    })
    const ids = listed.json().categories.map((one: { id: string }) => one.id)

    const wrong = await server.inject({
      method: 'PUT',
      url: '/api/admin/song-categories/order',
      headers: { cookie: organiser.cookie },
      payload: { ids: [ids[0]] },
    })
    expect(wrong.statusCode).toBe(400)

    const flipped = await server.inject({
      method: 'PUT',
      url: '/api/admin/song-categories/order',
      headers: { cookie: organiser.cookie },
      payload: { ids: [ids[1], ids[0]] },
    })
    expect(flipped.json().categories.map((one: { label: string }) => one.label)).toEqual(['Song', 'Chant'])
  })
})

describe('who may be named on a song', () => {
  it('takes every approved account, since the book belongs to no burn', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')
    const bo = await givenAccount('Bo')
    const nobody = await givenAccount('Nobody', [])

    const listed = await server.inject({
      method: 'GET',
      url: '/api/accounts',
      headers: { cookie: ada.cookie },
    })

    expect(
      listed
        .json()
        .accounts.map((one: { account_id: string }) => one.account_id)
        .toSorted(),
    ).toEqual([ada.id, bo.id].toSorted())
    expect(listed.json().accounts).not.toContainEqual(expect.objectContaining({ account_id: nobody.id }))
  })

  it('is refused to somebody with no role of their own', async () => {
    const server = await build()
    const nobody = await givenAccount('Nobody', [])

    expect(
      (await server.inject({ method: 'GET', url: '/api/accounts', headers: { cookie: nobody.cookie } }))
        .statusCode,
    ).toBe(403)
  })
})
