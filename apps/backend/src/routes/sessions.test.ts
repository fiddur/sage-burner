import type { FastifyInstance } from 'fastify'

import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, event, place, session } from '../db/schema.ts'
import { SESSION_COOKIE } from './auth.ts'

const SECRET = 's'.repeat(40)
const NOW = '2026-07-02T00:00:00.000Z'
const SLOT = { time_slot_start: '2026-08-02T18:00:00.000Z', time_slot_end: '2026-08-02T20:00:00.000Z' }

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

const givenAccount = async (roles: ('admin' | 'member')[]) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return { id, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
}

const givenEvent = async () => {
  const id = randomUUID()
  await db()
    .insert(event)
    .values({
      id,
      name: 'Summer burn',
      slug: `burn-${id.slice(0, 8)}`,
      start_date: '2026-08-01',
      end_date: '2026-08-05',
      member_cap: 42,
      created_at: NOW,
    })
  return id
}

const givenPlace = async (name = 'Temple') => {
  const id = randomUUID()
  await db().insert(place).values({ id, order: 0, name, emoji: '🛕', color: 'yellow' })
  return id
}

const list = (server: FastifyInstance, cookie: string | undefined) =>
  server.inject({
    method: 'GET',
    url: '/api/events/active/sessions',
    headers: cookie === undefined ? {} : { cookie },
  })

const offer = (server: FastifyInstance, cookie: string | undefined, payload: Record<string, unknown>) =>
  server.inject({
    method: 'POST',
    url: '/api/events/active/sessions',
    headers: cookie === undefined ? {} : { cookie },
    payload,
  })

const editDream = (
  server: FastifyInstance,
  cookie: string | undefined,
  id: string,
  payload: Record<string, unknown>,
) =>
  server.inject({
    method: 'PATCH',
    url: `/api/sessions/${id}`,
    headers: cookie === undefined ? {} : { cookie },
    payload,
  })

const drop = (server: FastifyInstance, cookie: string | undefined, id: string) =>
  server.inject({
    method: 'DELETE',
    url: `/api/sessions/${id}`,
    headers: cookie === undefined ? {} : { cookie },
  })

describe('dreams', () => {
  it('is empty before anyone offers one', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])

    const response = await list(server, member.cookie)

    expect(response.statusCode).toBe(200)
    expect(response.json().sessions).toEqual([])
  })

  it('is empty rather than 404 when no burn is open', async () => {
    // The ordinary state of a fresh deployment, not an error.
    const server = await build()
    const member = await givenAccount(['member'])

    const response = await list(server, member.cookie)

    expect(response.statusCode).toBe(200)
    expect(response.json().sessions).toEqual([])
  })

  it('offers one with no time and no place, which is the normal state', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])

    const response = await offer(server, member.cookie, { title: 'Sunrise yoga' })

    expect(response.statusCode).toBe(201)
    expect(response.json().session).toMatchObject({
      title: 'Sunrise yoga',
      description: '',
      time_slot_start: null,
      time_slot_end: null,
      place_id: null,
      host_account_id: member.id,
    })
  })

  it('hosts it in the name of whoever offered it, whatever the body says', async () => {
    // A dream in someone else's name is not an edit anyone should make by hand.
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])
    const other = await givenAccount(['member'])

    const response = await offer(server, member.cookie, {
      title: 'Sunrise yoga',
      host_account_id: other.id,
    })

    expect(response.statusCode).toBe(400)
  })

  it('refuses to attach it to a burn the caller did not name', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])

    expect((await offer(server, member.cookie, { title: 'x', event_id: randomUUID() })).statusCode).toBe(400)
  })

  it('answers 404 when there is no burn to offer it to', async () => {
    const server = await build()
    const member = await givenAccount(['member'])

    expect((await offer(server, member.cookie, { title: 'Sunrise yoga' })).statusCode).toBe(404)
  })

  it('schedules one into a place and a slot', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])
    const temple = await givenPlace()
    const id = (await offer(server, member.cookie, { title: 'Sunrise yoga' })).json().session.id

    const response = await editDream(server, member.cookie, id, { ...SLOT, place_id: temple })

    expect(response.statusCode).toBe(200)
    expect(response.json().session).toMatchObject({ ...SLOT, place_id: temple })
  })

  it('refuses a place that does not exist', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])

    expect((await offer(server, member.cookie, { title: 'x', place_id: randomUUID() })).statusCode).toBe(400)

    const id = (await offer(server, member.cookie, { title: 'y' })).json().session.id
    expect((await editDream(server, member.cookie, id, { place_id: randomUUID() })).statusCode).toBe(400)
  })

  it('refuses a slot that ends before it starts', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])

    const response = await offer(server, member.cookie, {
      title: 'Backwards',
      time_slot_start: SLOT.time_slot_end,
      time_slot_end: SLOT.time_slot_start,
    })

    expect(response.statusCode).toBe(400)
  })

  it('refuses half a slot at creation', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])

    expect(
      (await offer(server, member.cookie, { title: 'x', time_slot_start: SLOT.time_slot_start })).statusCode,
    ).toBe(400)
  })

  it('refuses a single end that would leave half a slot on the stored row', async () => {
    // The case the schema cannot see: the body carries one end, and whether that
    // is whole depends on the row. Composed into the WHERE rather than compared
    // after a read.
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])
    const id = (await offer(server, member.cookie, { title: 'Unscheduled' })).json().session.id

    const response = await editDream(server, member.cookie, id, { time_slot_start: SLOT.time_slot_start })

    expect(response.statusCode).toBe(400)
    const [row] = await db().select().from(session).where(eq(session.id, id))
    expect(row?.time_slot_start).toBeNull()
  })

  it('accepts a single end that keeps the slot whole', async () => {
    // The passing sibling: the condition must not refuse an ordinary reschedule.
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])
    const id = (await offer(server, member.cookie, { title: 'Scheduled', ...SLOT })).json().session.id

    const response = await editDream(server, member.cookie, id, {
      time_slot_end: '2026-08-02T21:00:00.000Z',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().session.time_slot_end).toBe('2026-08-02T21:00:00.000Z')
  })

  it('refuses clearing one end alone, and allows clearing both', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])
    const id = (await offer(server, member.cookie, { title: 'Scheduled', ...SLOT })).json().session.id

    expect((await editDream(server, member.cookie, id, { time_slot_start: null })).statusCode).toBe(400)

    const cleared = await editDream(server, member.cookie, id, {
      time_slot_start: null,
      time_slot_end: null,
    })
    expect(cleared.statusCode).toBe(200)
    expect(cleared.json().session.time_slot_start).toBeNull()
  })

  it('unschedules by clearing the place without touching the time', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])
    const temple = await givenPlace()
    const id = (await offer(server, member.cookie, { title: 'x', ...SLOT, place_id: temple })).json().session
      .id

    const response = await editDream(server, member.cookie, id, { place_id: null })

    expect(response.statusCode).toBe(200)
    expect(response.json().session.place_id).toBeNull()
    expect(response.json().session.time_slot_start).toBe(SLOT.time_slot_start)
  })

  it('treats an empty edit as a read rather than a 500', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])
    const id = (await offer(server, member.cookie, { title: 'Sunrise yoga' })).json().session.id

    const response = await editDream(server, member.cookie, id, {})

    expect(response.statusCode).toBe(200)
    expect(response.json().session.title).toBe('Sunrise yoga')
  })

  it('answers 404 for an empty edit of a dream that is not there', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])

    expect((await editDream(server, member.cookie, randomUUID(), {})).statusCode).toBe(404)
  })

  it('answers 404 when editing or deleting a dream that is not there', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])

    expect((await editDream(server, member.cookie, randomUUID(), { title: 'x' })).statusCode).toBe(404)
    expect((await drop(server, member.cookie, randomUUID())).statusCode).toBe(404)
  })

  it('withdraws one', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])
    const id = (await offer(server, member.cookie, { title: 'Sunrise yoga' })).json().session.id

    expect((await drop(server, member.cookie, id)).statusCode).toBe(204)
    expect((await list(server, member.cookie)).json().sessions).toEqual([])
  })

  it('lets any member arrange the schedule, not only whoever offered it', async () => {
    // #20: the schedule belongs to the members, not to the dream's host.
    const server = await build()
    await givenEvent()
    const host = await givenAccount(['member'])
    const someone = await givenAccount(['member'])
    const temple = await givenPlace()
    const id = (await offer(server, host.cookie, { title: 'Sunrise yoga' })).json().session.id

    const response = await editDream(server, someone.cookie, id, { ...SLOT, place_id: temple })

    expect(response.statusCode).toBe(200)
  })

  it('sorts scheduled dreams by when they happen, and the unscheduled last', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])
    await offer(server, member.cookie, { title: 'Offered only' })
    await offer(server, member.cookie, {
      title: 'Later',
      time_slot_start: '2026-08-03T10:00:00.000Z',
      time_slot_end: '2026-08-03T11:00:00.000Z',
    })
    await offer(server, member.cookie, { title: 'Earlier', ...SLOT })

    const titles = (await list(server, member.cookie))
      .json()
      .sessions.map((row: { title: string }) => row.title)

    expect(titles).toEqual(['Earlier', 'Later', 'Offered only'])
  })

  it('refuses everyone who is not a member', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])
    const admin = await givenAccount(['admin'])
    const id = (await offer(server, member.cookie, { title: 'Sunrise yoga' })).json().session.id

    for (const [cookie, expected] of [
      [undefined, 401],
      [admin.cookie, 403],
    ] as const) {
      expect((await list(server, cookie)).statusCode).toBe(expected)
      expect((await offer(server, cookie, { title: 'Theirs' })).statusCode).toBe(expected)
      expect((await editDream(server, cookie, id, { title: 'Theirs' })).statusCode).toBe(expected)
      expect((await drop(server, cookie, id)).statusCode).toBe(expected)
    }

    expect((await list(server, member.cookie)).json().sessions).toHaveLength(1)
  })

  it('refuses a stray key rather than silently ignoring it', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])

    expect((await offer(server, member.cookie, { title: 'x', location: 'Temple' })).statusCode).toBe(400)
  })
})

describe('a place a dream is standing in', () => {
  const removePlace = (server: FastifyInstance, cookie: string, id: string) =>
    server.inject({ method: 'DELETE', url: `/api/admin/places/${id}`, headers: { cookie } })

  it('cannot be deleted out from under it', async () => {
    const server = await build()
    await givenEvent()
    const admin = await givenAccount(['admin', 'member'])
    const temple = await givenPlace()
    await offer(server, admin.cookie, { title: 'Sunrise yoga', ...SLOT, place_id: temple })

    const response = await removePlace(server, admin.cookie, temple)

    expect(response.statusCode).toBe(409)
    expect((await db().select().from(place)).map((row) => row.id)).toEqual([temple])
  })

  it('is deleted once nothing stands in it', async () => {
    // The passing sibling: the refusal must be about the dream, not about
    // deleting places at all.
    const server = await build()
    await givenEvent()
    const admin = await givenAccount(['admin', 'member'])
    const temple = await givenPlace()
    const id = (await offer(server, admin.cookie, { title: 'x', ...SLOT, place_id: temple })).json().session
      .id
    await editDream(server, admin.cookie, id, { place_id: null })

    expect((await removePlace(server, admin.cookie, temple)).statusCode).toBe(204)
  })
})
