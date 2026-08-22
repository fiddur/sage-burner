import type { FastifyInstance } from 'fastify'

import { placeResponseSchema } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, event, place, session } from '../db/schema.ts'
import { sendGuarded } from '../if-match.testing.ts'

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
  sendGuarded((extra) =>
    server.inject({
      method: 'PATCH',
      url: `/api/places/${id}`,
      headers: { ...(cookie === undefined ? {} : { cookie }), ...extra },
      payload,
    }),
  )

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
  sendGuarded((extra) =>
    server.inject({
      method: 'PUT',
      url: `/api/events/${eventId}/places/order`,
      headers: { ...(cookie === undefined ? {} : { cookie }), ...extra },
      payload,
    }),
  )

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

const directPlace = (eventId: string, name = 'Nowhere', emoji = '🛕', color = 'chartreuse') =>
  client()
    .prepare('insert into place (id, event_id, "order", name, emoji, color) values (?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), eventId, 0, name, emoji, color)

const givenLanes = (eventId: string, ...lanes: { name: string; emoji: string; color: string }[]) =>
  lanes.map((lane, index) => {
    const id = randomUUID()
    client()
      .prepare('insert into place (id, event_id, "order", name, emoji, color) values (?, ?, ?, ?, ?, ?)')
      .run(id, eventId, index, lane.name, lane.emoji, lane.color)
    return id
  })

describe('the places a dream can happen at', () => {
  it('is empty before an admin adds any', async () => {
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
    expect(placeResponseSchema.safeParse(response.json()).success).toBe(true)
  })

  it('puts each new place after the last, rather than all at zero', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])

    await givenPlaces(server, admin.cookie, eventId)

    expect(await names(server, eventId)).toEqual(['Temple', 'Sauna', 'Front Lawn'])
  })

  it('refuses an order the caller tried to choose', async () => {
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

describe('a burn that has ended', () => {
  it('refuses to rename or remove one of its lanes', async () => {
    const server = await build()
    const gone = await givenEvent('Last summer', '2025-08-01')
    const admin = await givenAccount(['admin'])
    const [temple] = givenLanes(gone, TEMPLE)

    expect((await edit(server, admin.cookie, temple ?? '', { name: 'Rewritten' })).statusCode).toBe(404)
    expect((await remove(server, admin.cookie, temple ?? '')).statusCode).toBe(404)
    expect(await names(server, gone)).toEqual(['Temple'])
  })

  it('refuses an empty edit of one too, which takes its own path through the route', async () => {
    const server = await build()
    const gone = await givenEvent('Last summer', '2025-08-01')
    const admin = await givenAccount(['admin'])
    const [temple] = givenLanes(gone, TEMPLE)

    expect((await edit(server, admin.cookie, temple ?? '', {})).statusCode).toBe(404)
  })

  it('refuses to add a lane, reorder its grid, or copy one in', async () => {
    const server = await build()
    const gone = await givenEvent('Last summer', '2025-08-01')
    const source = await givenEvent('Two summers ago', '2024-08-01')
    const admin = await givenAccount(['admin'])
    const [temple] = givenLanes(gone, TEMPLE)
    givenLanes(source, SAUNA)

    expect((await add(server, admin.cookie, gone, LAWN)).statusCode).toBe(404)
    expect((await reorder(server, admin.cookie, gone, { ids: [temple ?? ''] })).statusCode).toBe(404)
    expect((await copyFrom(server, admin.cookie, gone, source)).statusCode).toBe(404)
    expect(await names(server, gone)).toEqual(['Temple'])
  })

  it('is still readable, and still worth copying from', async () => {
    const server = await build()
    const gone = await givenEvent('Last summer', '2025-08-01')
    const next = await givenEvent('Next summer', '2026-08-01')
    const admin = await givenAccount(['admin'])
    givenLanes(gone, TEMPLE, SAUNA)

    expect(await names(server, gone)).toEqual(['Temple', 'Sauna'])
    expect((await copyFrom(server, admin.cookie, next, gone)).statusCode).toBe(201)
    expect(await names(server, next)).toEqual(['Temple', 'Sauna'])
  })

  it('refuses to remove a lane a live dream is planned into', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    const temple = (await add(server, admin.cookie, eventId, TEMPLE)).json().place.id

    await db().insert(session).values({
      id: randomUUID(),
      event_id: eventId,
      title: 'Sunrise yoga',
      time_slot_start: '2026-08-02T18:00:00.000Z',
      time_slot_end: '2026-08-02T20:00:00.000Z',
      place_id: temple,
    })

    expect((await remove(server, admin.cookie, temple)).statusCode).toBe(409)
  })

  it('removes a lane whose only dream was withdrawn, unscheduling the withdrawn dream', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    const temple = (await add(server, admin.cookie, eventId, TEMPLE)).json().place.id
    const dreamId = randomUUID()

    await db().insert(session).values({
      id: dreamId,
      event_id: eventId,
      title: 'Sunrise yoga',
      time_slot_start: '2026-08-02T18:00:00.000Z',
      time_slot_end: '2026-08-02T20:00:00.000Z',
      place_id: temple,
      withdrawn_at: NOW,
    })

    expect((await remove(server, admin.cookie, temple)).statusCode).toBe(204)

    const [held] = await db().select().from(session).where(eq(session.id, dreamId))
    expect(held).toMatchObject({
      place_id: null,
      time_slot_start: null,
      time_slot_end: null,
      withdrawn_at: NOW,
    })
  })

  it('leaves a live dream planned elsewhere alone when a withdrawn one frees its lane', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    const temple = (await add(server, admin.cookie, eventId, TEMPLE)).json().place.id
    const sauna = (await add(server, admin.cookie, eventId, SAUNA)).json().place.id

    await db().insert(session).values({
      id: randomUUID(),
      event_id: eventId,
      title: 'Withdrawn one',
      place_id: temple,
      time_slot_start: '2026-08-02T18:00:00.000Z',
      time_slot_end: '2026-08-02T20:00:00.000Z',
      withdrawn_at: NOW,
    })
    const living = randomUUID()
    await db().insert(session).values({
      id: living,
      event_id: eventId,
      title: 'Living one',
      place_id: sauna,
      time_slot_start: '2026-08-02T18:00:00.000Z',
      time_slot_end: '2026-08-02T20:00:00.000Z',
    })

    expect((await remove(server, admin.cookie, temple)).statusCode).toBe(204)

    const [held] = await db().select().from(session).where(eq(session.id, living))
    expect(held?.place_id).toBe(sauna)
  })

  it('counts a burn ending today as still open, so the last day is not too late', async () => {
    const server = await build()
    const today = await givenEvent('Ends today', '2026-07-02')
    const admin = await givenAccount(['admin'])
    const temple = (await add(server, admin.cookie, today, TEMPLE)).json().place.id

    expect((await edit(server, admin.cookie, temple, { name: 'Steam Room' })).statusCode).toBe(200)
    expect((await remove(server, admin.cookie, temple)).statusCode).toBe(204)
  })

  it('leaves a burn that has not started alone, even when it is not the next one', async () => {
    const server = await build()
    await givenEvent('Next summer', '2026-08-01')
    const winter = await givenEvent('Next winter', '2026-12-01')
    const admin = await givenAccount(['admin'])

    const added = await add(server, admin.cookie, winter, TEMPLE)
    expect(added.statusCode).toBe(201)

    const temple = added.json().place.id
    const sauna = (await add(server, admin.cookie, winter, SAUNA)).json().place.id

    expect((await edit(server, admin.cookie, temple, { name: 'Steam Room' })).statusCode).toBe(200)
    expect((await reorder(server, admin.cookie, winter, { ids: [sauna, temple] })).statusCode).toBe(200)
    expect((await remove(server, admin.cookie, temple)).statusCode).toBe(204)
    expect(await names(server, winter)).toEqual(['Sauna'])
  })
})

describe('seeding a burn’s grid from a previous one', () => {
  it('copies the lanes in the order they were in', async () => {
    const server = await build()
    const last = await givenEvent('Last summer', '2025-08-01')
    const next = await givenEvent('Next summer', '2026-08-01')
    const admin = await givenAccount(['admin'])
    const [lawn] = givenLanes(last, LAWN, TEMPLE, SAUNA)

    const copied = await copyFrom(server, admin.cookie, next, last)

    expect(copied.statusCode).toBe(201)
    expect(copied.json().places.map((entry: { name: string }) => entry.name)).toEqual([
      'Front Lawn',
      'Temple',
      'Sauna',
    ])
    expect(copied.json().places.map((entry: { id: string }) => entry.id)).not.toContain(lawn)
    expect(await names(server, last)).toEqual(['Front Lawn', 'Temple', 'Sauna'])
  })

  it('gives the copies to the burn that asked for them', async () => {
    const server = await build()
    const last = await givenEvent('Last', '2025-08-01')
    const next = await givenEvent('Next', '2026-08-01')
    const admin = await givenAccount(['admin'])
    givenLanes(last, TEMPLE)

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
    givenLanes(last, TEMPLE)
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
    givenLanes(last, TEMPLE)

    expect((await copyFrom(server, admin.cookie, randomUUID(), last)).statusCode).toBe(404)
  })

  it('answers 404 for a burn that does not exist even when the source is empty', async () => {
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
    givenLanes(older, TEMPLE)
    givenLanes(newer, TEMPLE, SAUNA)
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

describe('writing over what somebody else changed', () => {
  const writeLane = (
    server: FastifyInstance,
    cookie: string,
    id: string,
    payload: Record<string, unknown>,
    version?: string,
  ) =>
    server.inject({
      method: 'PATCH',
      url: `/api/places/${id}`,
      headers: { cookie, ...(version === undefined ? {} : { 'if-match': version }) },
      payload,
    })

  it('tags the grid on the way out, so a writer has something to quote back', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])

    const before = await list(server, eventId)
    expect(before.headers.etag).toMatch(/^"[\w-]+"$/)

    expect((await list(server, eventId)).headers.etag).toBe(before.headers.etag)

    const [temple] = await givenPlaces(server, admin.cookie, eventId)
    await edit(server, admin.cookie, temple ?? '', { name: 'Somewhere else' })

    expect((await list(server, eventId)).headers.etag).not.toBe(before.headers.etag)
  })

  it('refuses a write quoting nothing at all, and says what the grid holds', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    const [, sauna] = await givenPlaces(server, admin.cookie, eventId)

    const response = await writeLane(server, admin.cookie, sauna ?? '', { name: 'Steam Room' })

    expect(response.statusCode).toBe(428)
    expect(response.json().error).toBe('precondition_required')
    expect(response.json().places.map((lane: { name: string }) => lane.name)).toEqual([
      'Temple',
      'Sauna',
      'Front Lawn',
    ])
    expect(await names(server, eventId)).toEqual(['Temple', 'Sauna', 'Front Lawn'])
  })

  it('refuses one quoting a version somebody has since moved past', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const bea = await givenAccount(['member'])
    const [temple, sauna] = await givenPlaces(server, ada.cookie, eventId)

    const asAdaSawIt = (await list(server, eventId)).headers.etag
    expect(typeof asAdaSawIt).toBe('string')

    expect((await edit(server, bea.cookie, temple ?? '', { name: 'The Temple' })).statusCode).toBe(200)

    const response = await writeLane(
      server,
      ada.cookie,
      sauna ?? '',
      { name: 'Steam Room' },
      String(asAdaSawIt),
    )

    expect(response.statusCode).toBe(412)
    expect(response.json().error).toBe('stale')
    expect(response.json().places.map((lane: { name: string }) => lane.name)).toEqual([
      'The Temple',
      'Sauna',
      'Front Lawn',
    ])
    expect(await names(server, eventId)).toEqual(['The Temple', 'Sauna', 'Front Lawn'])
  })

  it('takes one quoting the version it was given', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    const [, sauna] = await givenPlaces(server, admin.cookie, eventId)

    const current = (await list(server, eventId)).headers.etag
    const response = await writeLane(
      server,
      admin.cookie,
      sauna ?? '',
      { name: 'Steam Room' },
      String(current),
    )

    expect(response.statusCode).toBe(200)
    expect(await names(server, eventId)).toEqual(['Temple', 'Steam Room', 'Front Lawn'])
  })

  it('hands back a tag the retry can use, so a conflict costs one round trip', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    const [, sauna] = await givenPlaces(server, admin.cookie, eventId)

    const refused = await writeLane(server, admin.cookie, sauna ?? '', { name: 'Steam Room' })
    expect(refused.statusCode).toBe(428)

    const retried = await writeLane(
      server,
      admin.cookie,
      sauna ?? '',
      { name: 'Steam Room' },
      String(refused.headers.etag),
    )

    expect(retried.statusCode).toBe(200)
  })

  it('answers a successful write with the tag the next one must quote', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    const [, sauna] = await givenPlaces(server, admin.cookie, eventId)

    const first = await writeLane(
      server,
      admin.cookie,
      sauna ?? '',
      { name: 'Steam Room' },
      String((await list(server, eventId)).headers.etag),
    )
    expect(first.headers.etag).toBe((await list(server, eventId)).headers.etag)

    const second = await writeLane(
      server,
      admin.cookie,
      sauna ?? '',
      { name: 'Sweat Lodge' },
      String(first.headers.etag),
    )

    expect(second.statusCode).toBe(200)
  })

  it('guards the ordering too, which is one write over the whole list', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    const [temple, sauna, lawn] = await givenPlaces(server, admin.cookie, eventId)

    const response = await server.inject({
      method: 'PUT',
      url: `/api/events/${eventId}/places/order`,
      headers: { cookie: admin.cookie },
      payload: { ids: [lawn, sauna, temple] },
    })

    expect(response.statusCode).toBe(428)
    expect(await names(server, eventId)).toEqual(['Temple', 'Sauna', 'Front Lawn'])
  })

  it('leaves the writes that add or remove alone, which have nothing to overwrite', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])

    expect((await add(server, admin.cookie, eventId, TEMPLE)).statusCode).toBe(201)

    const [temple] = await givenPlaces(server, admin.cookie, eventId)
    expect((await remove(server, admin.cookie, temple ?? '')).statusCode).toBe(204)
  })
})
