import type { FastifyInstance } from 'fastify'

import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, place } from '../db/schema.ts'
import { SESSION_COOKIE } from './auth.ts'

const SECRET = 's'.repeat(40)
const NOW = '2026-07-02T00:00:00.000Z'

let handle: DbHandle | undefined
let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  handle?.close()
  app = undefined
  handle = undefined
})

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

const db = () => {
  const found = handle?.db
  if (found === undefined) throw new Error('build() first')
  return found
}

const client = () => {
  const found = handle?.client
  if (found === undefined) throw new Error('build() first')
  return found
}

const givenAccount = async (roles: ('admin' | 'member')[]) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return { id, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
}

const list = (server: FastifyInstance) => server.inject({ method: 'GET', url: '/api/places' })

const add = (server: FastifyInstance, cookie: string | undefined, payload: Record<string, unknown>) =>
  server.inject({
    method: 'POST',
    url: '/api/places',
    headers: cookie === undefined ? {} : { cookie },
    payload,
  })

const edit = (
  server: FastifyInstance,
  cookie: string | undefined,
  id: string,
  payload: Record<string, unknown>,
) =>
  server.inject({
    method: 'PATCH',
    url: `/api/places/${id}`,
    headers: cookie === undefined ? {} : { cookie },
    payload,
  })

const remove = (server: FastifyInstance, cookie: string | undefined, id: string) =>
  server.inject({
    method: 'DELETE',
    url: `/api/places/${id}`,
    headers: cookie === undefined ? {} : { cookie },
  })

const reorder = (server: FastifyInstance, cookie: string | undefined, payload: Record<string, unknown>) =>
  server.inject({
    method: 'PUT',
    url: '/api/places/order',
    headers: cookie === undefined ? {} : { cookie },
    payload,
  })

const TEMPLE = { name: 'Temple', emoji: '🛕', color: 'yellow' }
const SAUNA = { name: 'Sauna', emoji: '🥵', color: 'red' }
const LAWN = { name: 'Front Lawn', emoji: '🌳', color: 'green' }

const givenPlaces = async (server: FastifyInstance, cookie: string) => {
  const ids: string[] = []
  for (const body of [TEMPLE, SAUNA, LAWN]) ids.push((await add(server, cookie, body)).json().place.id)
  return ids
}

const names = (server: FastifyInstance) =>
  list(server).then((response) => response.json().places.map((entry: { name: string }) => entry.name))

describe('the places a dream can happen at', () => {
  it('is empty before an organiser adds any', async () => {
    const server = await build()

    const response = await list(server)

    expect(response.statusCode).toBe(200)
    expect(response.json().places).toEqual([])
  })

  it('is readable without signing in, because the ICS feed publishes locations anyway', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    await add(server, admin.cookie, TEMPLE)

    const response = await list(server)

    expect(response.statusCode).toBe(200)
    expect(response.json().places[0].name).toBe('Temple')
  })

  it('adds one, with the server choosing where it goes', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])

    const response = await add(server, admin.cookie, TEMPLE)

    expect(response.statusCode).toBe(201)
    expect(response.json().place).toMatchObject({ ...TEMPLE, order: 0 })
    expect(response.json().place.id).toEqual(expect.any(String))
  })

  it('puts each new place after the last, rather than all at zero', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])

    await givenPlaces(server, admin.cookie)

    expect(await names(server)).toEqual(['Temple', 'Sauna', 'Front Lawn'])
  })

  it('refuses an order the caller tried to choose', async () => {
    // The server assigns it. Accepting one here would let two places claim the
    // same lane.
    const server = await build()
    const admin = await givenAccount(['admin'])

    expect((await add(server, admin.cookie, { ...TEMPLE, order: 0 })).statusCode).toBe(400)
  })

  it('refuses a colour outside the palette, a blank name and a blank emoji', async () => {
    // The palette is fixed so the grid stays legible — a lane the organiser
    // picked `#fefefe` for is one nothing in the app could correct.
    const server = await build()
    const admin = await givenAccount(['admin'])

    expect((await add(server, admin.cookie, { ...TEMPLE, color: 'chartreuse' })).statusCode).toBe(400)
    expect((await add(server, admin.cookie, { ...TEMPLE, name: '  ' })).statusCode).toBe(400)
    expect((await add(server, admin.cookie, { ...TEMPLE, emoji: '' })).statusCode).toBe(400)
    expect(await names(server)).toEqual([])
  })

  it('accepts a multi-codepoint emoji, which a regex would have rejected', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])

    const response = await add(server, admin.cookie, { ...TEMPLE, emoji: '👩‍🚀' })

    expect(response.statusCode).toBe(201)
    expect(response.json().place.emoji).toBe('👩‍🚀')
  })

  it('renames one without disturbing its lane or the others', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const [, sauna] = await givenPlaces(server, admin.cookie)

    const response = await edit(server, admin.cookie, sauna ?? '', { name: 'Steam Room' })

    expect(response.statusCode).toBe(200)
    expect(response.json().place).toMatchObject({ name: 'Steam Room', emoji: '🥵', order: 1 })
    expect(await names(server)).toEqual(['Temple', 'Steam Room', 'Front Lawn'])
  })

  it('treats an empty edit as a read rather than a 500', async () => {
    // `set({})` is not valid SQL.
    const server = await build()
    const admin = await givenAccount(['admin'])
    const [temple] = await givenPlaces(server, admin.cookie)

    const response = await edit(server, admin.cookie, temple ?? '', {})

    expect(response.statusCode).toBe(200)
    expect(response.json().place.name).toBe('Temple')
  })

  it('answers 404 for an empty edit of a place that is not there', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])

    expect((await edit(server, admin.cookie, randomUUID(), {})).statusCode).toBe(404)
  })

  it('answers 404 when editing or deleting something that is not there', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])

    expect((await edit(server, admin.cookie, randomUUID(), { name: 'Nowhere' })).statusCode).toBe(404)
    expect((await remove(server, admin.cookie, randomUUID())).statusCode).toBe(404)
  })

  it('removes one and leaves the rest in order', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const [, sauna] = await givenPlaces(server, admin.cookie)

    expect((await remove(server, admin.cookie, sauna ?? '')).statusCode).toBe(204)
    expect(await names(server)).toEqual(['Temple', 'Front Lawn'])
  })

  it('reorders the whole list', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const [temple, sauna, lawn] = await givenPlaces(server, admin.cookie)

    const response = await reorder(server, admin.cookie, { ids: [lawn, temple, sauna] })

    expect(response.statusCode).toBe(200)
    expect(response.json().places.map((entry: { name: string }) => entry.name)).toEqual([
      'Front Lawn',
      'Temple',
      'Sauna',
    ])
    expect(await names(server)).toEqual(['Front Lawn', 'Temple', 'Sauna'])
  })

  it('refuses an ordering that does not name every place exactly once', async () => {
    // A partial list would renumber some rows and leave the rest on stale
    // positions, producing an order nobody chose.
    const server = await build()
    const admin = await givenAccount(['admin'])
    const [temple, sauna, lawn] = await givenPlaces(server, admin.cookie)

    expect((await reorder(server, admin.cookie, { ids: [temple, sauna] })).statusCode).toBe(400)
    expect(
      (await reorder(server, admin.cookie, { ids: [temple, sauna, lawn, randomUUID()] })).statusCode,
    ).toBe(400)
    expect((await reorder(server, admin.cookie, { ids: [temple, temple, sauna] })).statusCode).toBe(400)
    expect(await names(server)).toEqual(['Temple', 'Sauna', 'Front Lawn'])
  })

  it('lets any approved member write the lanes, admin or not', async () => {
    // A shared spreadsheet everyone could edit is what this replaces. The admin
    // case is not redundant: `admin` does not imply `member`, so an organiser who
    // is not attending holds one and not the other.
    const server = await build()

    for (const roles of [['member'], ['admin'], ['member', 'admin']] as const) {
      const { cookie } = await givenAccount([...roles])
      const added = await add(server, cookie, { ...SAUNA, name: `By ${roles.join('+')}` })

      expect(added.statusCode, roles.join('+')).toBe(201)
      const id = added.json().place.id
      expect((await edit(server, cookie, id, { name: `Edited by ${roles.join('+')}` })).statusCode).toBe(200)
      expect((await reorder(server, cookie, { ids: [id] })).statusCode).toBe(200)
      expect((await remove(server, cookie, id)).statusCode).toBe(204)
    }
  })

  it('refuses every write to a stranger, and to an account with no roles', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const roleless = await givenAccount([])
    const id = (await add(server, admin.cookie, TEMPLE)).json().place.id

    for (const cookie of [undefined, roleless.cookie]) {
      const expected = cookie === undefined ? 401 : 403
      expect((await add(server, cookie, SAUNA)).statusCode).toBe(expected)
      expect((await edit(server, cookie, id, { name: 'Theirs' })).statusCode).toBe(expected)
      expect((await remove(server, cookie, id)).statusCode).toBe(expected)
      expect((await reorder(server, cookie, { ids: [id] })).statusCode).toBe(expected)
    }

    expect(await names(server)).toEqual(['Temple'])
  })

  it('refuses a colour outside the palette even from a write that skips the API', async () => {
    // The CHECK exists for exactly the writes the Zod schema never sees.
    await build()

    expect(() =>
      client()
        .prepare('insert into place (id, "order", name, emoji, color) values (?, ?, ?, ?, ?)')
        .run(randomUUID(), 0, 'Nowhere', '🛕', 'chartreuse'),
    ).toThrow()
  })

  it('keeps an unnamed place out of the database, whatever the caller is', async () => {
    await build()

    expect(() =>
      client()
        .prepare('insert into place (id, "order", name, emoji, color) values (?, ?, ?, ?, ?)')
        .run(randomUUID(), 0, '   ', '🛕', 'red'),
    ).toThrow()
    expect(() =>
      client()
        .prepare('insert into place (id, "order", name, emoji, color) values (?, ?, ?, ?, ?)')
        .run(randomUUID(), 0, 'Temple', ' ', 'red'),
    ).toThrow()
  })

  it('has no rows to begin with, so the table exists', async () => {
    await build()

    expect(await db().select().from(place)).toEqual([])
  })
})
