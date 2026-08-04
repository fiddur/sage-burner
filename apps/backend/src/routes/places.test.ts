import type { FastifyInstance } from 'fastify'

import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, event, place } from '../db/schema.ts'
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

const givenEvent = async (name = 'Summer burn', start = '2026-08-01') => {
  const id = randomUUID()
  await db()
    .insert(event)
    .values({
      id,
      name,
      slug: `burn-${id.slice(0, 8)}`,
      start_date: start,
      end_date: start,
      member_cap: 42,
      created_at: NOW,
    })
  return id
}

const list = (server: FastifyInstance, eventId: string) =>
  server.inject({ method: 'GET', url: `/api/events/${eventId}/places` })

const add = (
  server: FastifyInstance,
  cookie: string | undefined,
  eventId: string,
  payload: Record<string, unknown>,
) =>
  server.inject({
    method: 'POST',
    url: `/api/events/${eventId}/places`,
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

const reorder = (
  server: FastifyInstance,
  cookie: string | undefined,
  eventId: string,
  payload: Record<string, unknown>,
) =>
  server.inject({
    method: 'PUT',
    url: `/api/events/${eventId}/places/order`,
    headers: cookie === undefined ? {} : { cookie },
    payload,
  })

const sources = (server: FastifyInstance, cookie: string | undefined, eventId: string) =>
  server.inject({
    method: 'GET',
    url: `/api/events/${eventId}/places/sources`,
    headers: cookie === undefined ? {} : { cookie },
  })

const copyFrom = (server: FastifyInstance, cookie: string, eventId: string, fromEventId: string) =>
  server.inject({
    method: 'POST',
    url: `/api/events/${eventId}/places/copy`,
    headers: { cookie },
    payload: { from_event_id: fromEventId },
  })

const TEMPLE = { name: 'Temple', emoji: '🛕', color: 'yellow' }
const SAUNA = { name: 'Sauna', emoji: '🥵', color: 'red' }
const LAWN = { name: 'Front Lawn', emoji: '🌳', color: 'green' }

const givenPlaces = async (server: FastifyInstance, cookie: string, eventId: string) => {
  const ids: string[] = []
  for (const body of [TEMPLE, SAUNA, LAWN]) {
    ids.push((await add(server, cookie, eventId, body)).json().place.id)
  }
  return ids
}

const names = (server: FastifyInstance, eventId: string) =>
  list(server, eventId).then((response) =>
    response.json().places.map((entry: { name: string }) => entry.name),
  )

/** A write that skips the API entirely, which is the only thing the CHECKs answer. */
const directPlace = (eventId: string, name = 'Nowhere', emoji = '🛕', color = 'chartreuse') =>
  client()
    .prepare('insert into place (id, event_id, "order", name, emoji, color) values (?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), eventId, 0, name, emoji, color)

describe('the places a dream can happen at', () => {
  it('is empty before an organiser adds any', async () => {
    const server = await build()
    const eventId = await givenEvent()

    const response = await list(server, eventId)

    expect(response.statusCode).toBe(200)
    expect(response.json().places).toEqual([])
  })

  it('is readable without signing in, because the ICS feed publishes locations anyway', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    await add(server, admin.cookie, eventId, TEMPLE)

    const response = await list(server, eventId)

    expect(response.statusCode).toBe(200)
    expect(response.json().places[0].name).toBe('Temple')
  })

  it('adds one, with the server choosing where it goes', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])

    const response = await add(server, admin.cookie, eventId, TEMPLE)

    expect(response.statusCode).toBe(201)
    expect(response.json().place).toMatchObject({ ...TEMPLE, order: 0, event_id: eventId })
    expect(response.json().place.id).toEqual(expect.any(String))
  })

  it('puts each new place after the last, rather than all at zero', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])

    await givenPlaces(server, admin.cookie, eventId)

    expect(await names(server, eventId)).toEqual(['Temple', 'Sauna', 'Front Lawn'])
  })

  it('refuses an order the caller tried to choose', async () => {
    // The server assigns it. Accepting one here would let two places claim the
    // same lane.
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])

    expect((await add(server, admin.cookie, eventId, { ...TEMPLE, order: 0 })).statusCode).toBe(400)
  })

  it('refuses a burn named in the body, since the path already says which', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const other = await givenEvent('Other burn')
    const admin = await givenAccount(['admin'])

    expect((await add(server, admin.cookie, eventId, { ...TEMPLE, event_id: other })).statusCode).toBe(400)
    expect(await names(server, other)).toEqual([])
  })

  it('answers 404 for a burn that does not exist', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])

    expect((await add(server, admin.cookie, randomUUID(), TEMPLE)).statusCode).toBe(404)
  })

  it('refuses a colour outside the palette, a blank name and a blank emoji', async () => {
    // The palette is fixed so the grid stays legible — a lane the organiser
    // picked `#fefefe` for is one nothing in the app could correct.
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])

    expect((await add(server, admin.cookie, eventId, { ...TEMPLE, color: 'chartreuse' })).statusCode).toBe(
      400,
    )
    expect((await add(server, admin.cookie, eventId, { ...TEMPLE, name: '  ' })).statusCode).toBe(400)
    expect((await add(server, admin.cookie, eventId, { ...TEMPLE, emoji: '' })).statusCode).toBe(400)
    expect(await names(server, eventId)).toEqual([])
  })

  it('accepts a multi-codepoint emoji, which a regex would have rejected', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])

    const response = await add(server, admin.cookie, eventId, { ...TEMPLE, emoji: '👩‍🚀' })

    expect(response.statusCode).toBe(201)
    expect(response.json().place.emoji).toBe('👩‍🚀')
  })

  it('renames one without disturbing its lane or the others', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    const [, sauna] = await givenPlaces(server, admin.cookie, eventId)

    const response = await edit(server, admin.cookie, sauna ?? '', { name: 'Steam Room' })

    expect(response.statusCode).toBe(200)
    expect(response.json().place).toMatchObject({ name: 'Steam Room', emoji: '🥵', order: 1 })
    expect(await names(server, eventId)).toEqual(['Temple', 'Steam Room', 'Front Lawn'])
  })

  it('treats an empty edit as a read rather than a 500', async () => {
    // `set({})` is not valid SQL.
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    const [temple] = await givenPlaces(server, admin.cookie, eventId)

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
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    const [, sauna] = await givenPlaces(server, admin.cookie, eventId)

    expect((await remove(server, admin.cookie, sauna ?? '')).statusCode).toBe(204)
    expect(await names(server, eventId)).toEqual(['Temple', 'Front Lawn'])
  })

  it('reorders the whole list', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    const [temple, sauna, lawn] = await givenPlaces(server, admin.cookie, eventId)

    const response = await reorder(server, admin.cookie, eventId, { ids: [lawn, temple, sauna] })

    expect(response.statusCode).toBe(200)
    expect(response.json().places.map((entry: { name: string }) => entry.name)).toEqual([
      'Front Lawn',
      'Temple',
      'Sauna',
    ])
    expect(await names(server, eventId)).toEqual(['Front Lawn', 'Temple', 'Sauna'])
  })

  it('refuses an ordering that does not name every place exactly once', async () => {
    // A partial list would renumber some rows and leave the rest on stale
    // positions, producing an order nobody chose.
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    const [temple, sauna, lawn] = await givenPlaces(server, admin.cookie, eventId)

    expect((await reorder(server, admin.cookie, eventId, { ids: [temple, sauna] })).statusCode).toBe(400)
    expect(
      (await reorder(server, admin.cookie, eventId, { ids: [temple, sauna, lawn, randomUUID()] })).statusCode,
    ).toBe(400)
    expect((await reorder(server, admin.cookie, eventId, { ids: [temple, temple, sauna] })).statusCode).toBe(
      400,
    )
    expect(await names(server, eventId)).toEqual(['Temple', 'Sauna', 'Front Lawn'])
  })

  it('lets any approved member write the lanes, admin or not', async () => {
    // A shared spreadsheet everyone could edit is what this replaces. The admin
    // case is not redundant: `admin` does not imply `member`, so an organiser who
    // is not attending holds one and not the other.
    const server = await build()
    const eventId = await givenEvent()

    for (const roles of [['member'], ['admin'], ['member', 'admin']] as const) {
      const { cookie } = await givenAccount([...roles])
      const added = await add(server, cookie, eventId, { ...SAUNA, name: `By ${roles.join('+')}` })

      expect(added.statusCode, roles.join('+')).toBe(201)
      const id = added.json().place.id
      expect((await edit(server, cookie, id, { name: `Edited by ${roles.join('+')}` })).statusCode).toBe(200)
      expect((await reorder(server, cookie, eventId, { ids: [id] })).statusCode).toBe(200)
      expect((await remove(server, cookie, id)).statusCode).toBe(204)
    }
  })

  it('refuses every write to a stranger, and to an account with no roles', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    const roleless = await givenAccount([])
    const id = (await add(server, admin.cookie, eventId, TEMPLE)).json().place.id

    for (const cookie of [undefined, roleless.cookie]) {
      const expected = cookie === undefined ? 401 : 403
      expect((await add(server, cookie, eventId, SAUNA)).statusCode).toBe(expected)
      expect((await edit(server, cookie, id, { name: 'Theirs' })).statusCode).toBe(expected)
      expect((await remove(server, cookie, id)).statusCode).toBe(expected)
      expect((await reorder(server, cookie, eventId, { ids: [id] })).statusCode).toBe(expected)
    }

    expect(await names(server, eventId)).toEqual(['Temple'])
  })

  it('refuses a colour outside the palette even from a write that skips the API', async () => {
    // The CHECK exists for exactly the writes the Zod schema never sees.
    await build()
    const eventId = await givenEvent()

    expect(() => directPlace(eventId)).toThrow()
  })

  it('keeps an unnamed place out of the database, whatever the caller is', async () => {
    await build()
    const eventId = await givenEvent()

    expect(() => directPlace(eventId, '   ', '🛕', 'red')).toThrow()
    expect(() => directPlace(eventId, 'Temple', ' ', 'red')).toThrow()
    expect(() => directPlace(eventId, 'Temple', '🛕', 'red')).not.toThrow()
  })

  it('refuses a lane belonging to no burn, even from a write that skips the API', async () => {
    await build()

    expect(() => directPlace(randomUUID(), 'Temple', '🛕', 'red')).toThrow()
  })

  it('has no rows to begin with, so the table exists', async () => {
    await build()

    expect(await db().select().from(place)).toEqual([])
  })
})

describe('one grid per burn', () => {
  it('keeps each burn to its own lanes', async () => {
    // The point of #156: a summer-only spot must not be a lane in the winter grid.
    const server = await build()
    const summer = await givenEvent('Summer burn', '2026-08-01')
    const winter = await givenEvent('Winter burn', '2026-12-01')
    const admin = await givenAccount(['admin'])

    await add(server, admin.cookie, summer, { ...TEMPLE, name: 'Event tent' })
    await add(server, admin.cookie, winter, { ...SAUNA, name: 'Barn' })

    expect(await names(server, summer)).toEqual(['Event tent'])
    expect(await names(server, winter)).toEqual(['Barn'])
  })

  it('numbers each burn from zero rather than from the last burn’s total', async () => {
    const server = await build()
    const first = await givenEvent('First burn', '2026-08-01')
    const second = await givenEvent('Second burn', '2026-12-01')
    const admin = await givenAccount(['admin'])
    await givenPlaces(server, admin.cookie, first)

    const added = await add(server, admin.cookie, second, TEMPLE)

    expect(added.json().place.order).toBe(0)
  })

  it('refuses to reorder using an id from another burn', async () => {
    const server = await build()
    const mine = await givenEvent('Mine', '2026-08-01')
    const theirs = await givenEvent('Theirs', '2026-12-01')
    const admin = await givenAccount(['admin'])
    const ours = (await add(server, admin.cookie, mine, TEMPLE)).json().place.id
    const alien = (await add(server, admin.cookie, theirs, SAUNA)).json().place.id

    expect((await reorder(server, admin.cookie, mine, { ids: [alien] })).statusCode).toBe(400)
    expect((await reorder(server, admin.cookie, mine, { ids: [ours, alien] })).statusCode).toBe(400)
    expect(await names(server, theirs)).toEqual(['Sauna'])
  })
})

describe('seeding a burn’s grid from a previous one', () => {
  it('copies the lanes in the order they were in', async () => {
    const server = await build()
    const last = await givenEvent('Last summer', '2025-08-01')
    const next = await givenEvent('Next summer', '2026-08-01')
    const admin = await givenAccount(['admin'])
    const [temple, sauna, lawn] = await givenPlaces(server, admin.cookie, last)
    await reorder(server, admin.cookie, last, { ids: [lawn, temple, sauna] })

    const copied = await copyFrom(server, admin.cookie, next, last)

    expect(copied.statusCode).toBe(201)
    expect(copied.json().places.map((entry: { name: string }) => entry.name)).toEqual([
      'Front Lawn',
      'Temple',
      'Sauna',
    ])
    // New rows, not the same ones moved across.
    expect(copied.json().places.map((entry: { id: string }) => entry.id)).not.toContain(temple)
    expect(await names(server, last)).toEqual(['Front Lawn', 'Temple', 'Sauna'])
  })

  it('gives the copies to the burn that asked for them', async () => {
    const server = await build()
    const last = await givenEvent('Last', '2025-08-01')
    const next = await givenEvent('Next', '2026-08-01')
    const admin = await givenAccount(['admin'])
    await add(server, admin.cookie, last, TEMPLE)

    await copyFrom(server, admin.cookie, next, last)

    const copied = (await list(server, next)).json().places
    expect(copied).toHaveLength(1)
    expect(copied[0].event_id).toBe(next)
  })

  it('refuses to copy into a grid that already has lanes', async () => {
    const server = await build()
    const last = await givenEvent('Last', '2025-08-01')
    const next = await givenEvent('Next', '2026-08-01')
    const admin = await givenAccount(['admin'])
    await add(server, admin.cookie, last, TEMPLE)
    await add(server, admin.cookie, next, SAUNA)

    expect((await copyFrom(server, admin.cookie, next, last)).statusCode).toBe(409)
    expect(await names(server, next)).toEqual(['Sauna'])
  })

  it('refuses copying a burn onto itself', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])

    expect((await copyFrom(server, admin.cookie, eventId, eventId)).statusCode).toBe(400)
  })

  it('answers 404 for a burn that does not exist', async () => {
    const server = await build()
    const last = await givenEvent('Last', '2025-08-01')
    const admin = await givenAccount(['admin'])
    await add(server, admin.cookie, last, TEMPLE)

    expect((await copyFrom(server, admin.cookie, randomUUID(), last)).statusCode).toBe(404)
  })

  it('answers 404 for a burn that does not exist even when the source is empty', async () => {
    // The foreign key only fires when there is a row to insert, so this used to
    // answer 201 with an empty grid.
    const server = await build()
    const last = await givenEvent('Last', '2025-08-01')
    const admin = await givenAccount(['admin'])

    expect((await copyFrom(server, admin.cookie, randomUUID(), last)).statusCode).toBe(404)
  })

  it('answers 404 for a source burn that does not exist', async () => {
    const server = await build()
    const next = await givenEvent('Next', '2026-08-01')
    const admin = await givenAccount(['admin'])

    expect((await copyFrom(server, admin.cookie, next, randomUUID())).statusCode).toBe(404)
  })

  it('offers the burns that have a grid, newest first, and never this one', async () => {
    const server = await build()
    const older = await givenEvent('Two summers ago', '2024-08-01')
    const newer = await givenEvent('Last summer', '2025-08-01')
    const bare = await givenEvent('A burn with no lanes', '2025-09-01')
    const next = await givenEvent('Next summer', '2026-08-01')
    const admin = await givenAccount(['admin'])
    await add(server, admin.cookie, older, TEMPLE)
    await add(server, admin.cookie, newer, TEMPLE)
    await add(server, admin.cookie, newer, SAUNA)
    await add(server, admin.cookie, next, LAWN)

    const offered = (await sources(server, admin.cookie, next)).json().sources

    expect(offered).toEqual([
      { event_id: newer, name: 'Last summer', count: 2 },
      { event_id: older, name: 'Two summers ago', count: 1 },
    ])
    expect(offered.map((row: { event_id: string }) => row.event_id)).not.toContain(bare)
  })

  it('needs a role to read the sources, unlike reading the grid itself', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const roleless = await givenAccount([])

    expect((await sources(server, undefined, eventId)).statusCode).toBe(401)
    expect((await sources(server, roleless.cookie, eventId)).statusCode).toBe(403)
    expect((await list(server, eventId)).statusCode).toBe(200)
  })
})
