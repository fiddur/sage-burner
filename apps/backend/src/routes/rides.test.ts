import type { Thread } from '@sage-burner/shared'
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
import { account, accountRole, attendance, event, ride } from '../db/schema.ts'
import { bell, setOn } from './threads.testing.ts'

const SECRET = 's'.repeat(40)
const NOW = '2026-07-02T00:00:00.000Z'
const OPEN_BURN = '9f1c2f2a-6f1a-4a2e-9c6d-2f0a1b3c4d5e'

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

const givenAccount = async (
  roles: ('admin' | 'member')[] = ['member'],
  over: { name?: string; contact?: string } = {},
) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({
      id,
      email: `${id}@example.org`,
      password_hash: null,
      created_at: NOW,
      name: over.name ?? 'Ada',
      contact: over.contact ?? '070 111 22 33',
    })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })

  return { id, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
}

const givenEvent = async (over: { id?: string; start_date?: string; end_date?: string } = {}) => {
  const id = over.id ?? OPEN_BURN
  await db()
    .insert(event)
    .values({
      id,
      name: 'Summer burn',
      slug: `burn-${id.slice(0, 8)}`,
      start_date: over.start_date ?? '2026-08-01',
      end_date: over.end_date ?? '2026-08-05',
      member_cap: 42,
      created_at: NOW,
    })

  return id
}

const A_JOURNEY = { kind: 'needs' as const, from: 'Göteborg', when: 'Friday afternoon', seats: 0, notes: '' }

const list = (server: FastifyInstance, cookie: string | undefined, eventId = OPEN_BURN) =>
  server.inject({
    method: 'GET',
    url: `/api/events/${eventId}/rides`,
    headers: cookie === undefined ? {} : { cookie },
  })

const post = (
  server: FastifyInstance,
  cookie: string | undefined,
  payload: Record<string, unknown> = A_JOURNEY,
  eventId = OPEN_BURN,
) =>
  server.inject({
    method: 'POST',
    url: `/api/events/${eventId}/rides`,
    headers: cookie === undefined ? {} : { cookie },
    payload,
  })

const patch = (
  server: FastifyInstance,
  cookie: string | undefined,
  id: string,
  payload: Record<string, unknown>,
) =>
  server.inject({
    method: 'PATCH',
    url: `/api/rides/${id}`,
    headers: cookie === undefined ? {} : { cookie },
    payload,
  })

const remove = (server: FastifyInstance, cookie: string | undefined, id: string) =>
  server.inject({
    method: 'DELETE',
    url: `/api/rides/${id}`,
    headers: cookie === undefined ? {} : { cookie },
  })

const givenComing = async (accountId: string, eventId = OPEN_BURN) => {
  await db()
    .insert(attendance)
    .values({ id: randomUUID(), event_id: eventId, account_id: accountId, joined_at: NOW })
}

const cards = async (server: FastifyInstance, cookie: string): Promise<Thread[]> =>
  (await server.inject({ method: 'GET', url: '/api/feed', headers: { cookie } })).json().threads

const say = (server: FastifyInstance, cookie: string, threadId: string, body: string) =>
  server.inject({
    method: 'POST',
    url: `/api/threads/${threadId}/comments`,
    headers: { cookie },
    payload: { body },
  })

const heart = (server: FastifyInstance, cookie: string, threadId: string) =>
  server.inject({ method: 'POST', url: `/api/threads/${threadId}/support/me`, headers: { cookie } })

const threadOf = async (server: FastifyInstance, cookie: string): Promise<string> =>
  (await list(server, cookie)).json().rides[0]?.thread_id ?? ''

describe('the rideshare board', () => {
  it('keeps both halves in one list, each saying which it is', async () => {
    const server = await build()
    await givenEvent()
    const ada = await givenAccount()
    await post(server, ada.cookie, { ...A_JOURNEY, kind: 'needs', from: 'Göteborg' })
    await post(server, ada.cookie, { ...A_JOURNEY, kind: 'offers', from: 'Malmö', seats: 3 })

    const { rides } = (await list(server, ada.cookie)).json()
    const byKind = new Map(rides.map((row: { kind: string; from: string }) => [row.kind, row.from]))

    expect(rides).toHaveLength(2)
    expect(byKind.get('needs')).toBe('Göteborg')
    expect(byKind.get('offers')).toBe('Malmö')
  })

  it('answers oldest first, which is the order it is read in', async () => {
    const server = await build()
    await givenEvent()
    const ada = await givenAccount()
    for (const [id, at, from] of [
      ['b', '2026-07-03T00:00:00.000Z', 'Later'],
      ['a', '2026-07-01T00:00:00.000Z', 'Earlier'],
    ] as const) {
      await db()
        .insert(ride)
        .values({ ...A_JOURNEY, id, event_id: OPEN_BURN, account_id: ada.id, from, created_at: at })
    }

    const { rides } = (await list(server, ada.cookie)).json()

    expect(rides.map((row: { from: string }) => row.from)).toEqual(['Earlier', 'Later'])
  })

  it('answers with the poster from the account, not from the row', async () => {
    const server = await build()
    await givenEvent()
    const ada = await givenAccount(['member'], { name: 'Ada Lovelace', contact: '070 111 22 33' })
    await post(server, ada.cookie)

    await db().update(account).set({ contact: '070 999 88 77' }).where(eq(account.id, ada.id))
    const { rides } = (await list(server, ada.cookie)).json()

    expect(rides[0].name).toBe('Ada Lovelace')
    expect(rides[0].contact).toBe('070 999 88 77')
  })

  it('takes the burn from the path and the poster from the session', async () => {
    const server = await build()
    await givenEvent()
    const ada = await givenAccount()

    const created = await post(server, ada.cookie)

    expect(created.statusCode).toBe(201)
    expect(created.json().ride.event_id).toBe(OPEN_BURN)
    expect(created.json().ride.account_id).toBe(ada.id)
  })

  it('refuses a body that names the burn or the poster itself', async () => {
    const server = await build()
    await givenEvent()
    const ada = await givenAccount()

    expect((await post(server, ada.cookie, { ...A_JOURNEY, event_id: OPEN_BURN })).statusCode).toBe(400)
    expect((await post(server, ada.cookie, { ...A_JOURNEY, account_id: ada.id })).statusCode).toBe(400)
  })

  it('refuses a journey with nowhere to come from', async () => {
    const server = await build()
    await givenEvent()
    const ada = await givenAccount()

    expect((await post(server, ada.cookie, { ...A_JOURNEY, from: '   ' })).statusCode).toBe(400)
    expect((await post(server, ada.cookie, { ...A_JOURNEY, when: '' })).statusCode).toBe(400)
    expect((await post(server, ada.cookie, { ...A_JOURNEY, seats: -1 })).statusCode).toBe(400)
  })

  it('is your own to change', async () => {
    const server = await build()
    await givenEvent()
    const ada = await givenAccount()
    const id = (await post(server, ada.cookie)).json().ride.id

    const changed = await patch(server, ada.cookie, id, { when: 'Saturday morning' })

    expect(changed.statusCode).toBe(200)
    expect(changed.json().ride.when).toBe('Saturday morning')
  })

  it('is nobody else’s, which is where this differs from the lanes beside it', async () => {
    const server = await build()
    await givenEvent()
    const ada = await givenAccount()
    const bea = await givenAccount()
    const id = (await post(server, ada.cookie)).json().ride.id

    expect((await patch(server, bea.cookie, id, { when: 'never' })).statusCode).toBe(403)
    expect((await remove(server, bea.cookie, id)).statusCode).toBe(403)

    const [row] = await db().select().from(ride).where(eq(ride.id, id))
    expect(row?.when).toBe('Friday afternoon')
  })

  it('is your own to withdraw', async () => {
    const server = await build()
    await givenEvent()
    const ada = await givenAccount()
    const id = (await post(server, ada.cookie)).json().ride.id

    expect((await remove(server, ada.cookie, id)).statusCode).toBe(204)
    expect(await db().select().from(ride)).toEqual([])
  })

  it('refuses a write to a burn that has ended, and still reads it', async () => {
    const server = await build()
    const ended = randomUUID()
    await givenEvent({ id: ended, start_date: '2025-08-01', end_date: '2025-08-05' })
    const ada = await givenAccount()
    const old = randomUUID()
    await db()
      .insert(ride)
      .values({ ...A_JOURNEY, id: old, event_id: ended, account_id: ada.id, created_at: NOW })

    expect((await post(server, ada.cookie, A_JOURNEY, ended)).statusCode).toBe(404)
    expect((await patch(server, ada.cookie, old, { when: 'never' })).statusCode).toBe(404)
    expect((await remove(server, ada.cookie, old)).statusCode).toBe(404)
    expect((await list(server, ada.cookie, ended)).json().rides).toHaveLength(1)
  })

  it('is for members and admins, and nobody else', async () => {
    const server = await build()
    await givenEvent()
    const ada = await givenAccount()
    const applicant = await givenAccount([])
    const organiser = await givenAccount(['admin'])
    const id = (await post(server, ada.cookie)).json().ride.id

    expect((await list(server, undefined)).statusCode).toBe(401)
    expect((await list(server, applicant.cookie)).statusCode).toBe(403)
    expect((await patch(server, applicant.cookie, id, { when: 'x' })).statusCode).toBe(403)
    expect((await list(server, organiser.cookie)).statusCode).toBe(200)
    expect((await post(server, organiser.cookie)).statusCode).toBe(201)
  })

  it('goes when the burn does, and when the person does', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount()
    await post(server, ada.cookie)

    expect(await db().select().from(ride)).toHaveLength(1)

    await db().delete(account).where(eq(account.id, ada.id))

    expect(await db().select().from(ride)).toEqual([])

    const bob = await givenAccount()
    await post(server, bob.cookie)

    expect(await db().select().from(ride)).toHaveLength(1)

    await db().delete(event).where(eq(event.id, eventId))

    expect(await db().select().from(ride)).toEqual([])
  })

  it('refuses a half of the board the vocabulary has never heard of', async () => {
    await build()
    await givenEvent()
    const ada = await givenAccount()

    expect(() =>
      client()
        .prepare(
          'insert into ride (id, event_id, account_id, kind, "from", "when", created_at)' +
            ' values (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(randomUUID(), OPEN_BURN, ada.id, 'maybe', 'Göteborg', 'Friday', NOW),
    ).toThrow()
  })

  it('refuses an empty journey and a negative seat count at the database too', async () => {
    await build()
    await givenEvent()
    const ada = await givenAccount()
    const insert = (over: { from?: string; when?: string; seats?: number }) =>
      client()
        .prepare(
          'insert into ride (id, event_id, account_id, kind, "from", "when", seats, created_at)' +
            ' values (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          randomUUID(),
          OPEN_BURN,
          ada.id,
          'needs',
          over.from ?? 'Göteborg',
          over.when ?? 'Friday',
          over.seats ?? 0,
          NOW,
        )

    expect(() => insert({ from: '   ' })).toThrow()
    expect(() => insert({ when: '' })).toThrow()
    expect(() => insert({ seats: -1 })).toThrow()
    expect(() => insert({})).not.toThrow()
  })

  it('answers an untouched patch without writing', async () => {
    const server = await build()
    await givenEvent()
    const ada = await givenAccount()
    const id = (await post(server, ada.cookie)).json().ride.id

    const answered = await patch(server, ada.cookie, id, {})

    expect(answered.statusCode).toBe(200)
    expect(answered.json().ride.from).toBe('Göteborg')
  })
})

describe('a journey on the feed', () => {
  it('opens a card headed by the journey, with the when on it and a line saying which it is', async () => {
    const server = await build()
    await givenEvent()
    const ada = await givenAccount()
    await givenComing(ada.id)

    await post(server, ada.cookie)

    const [card] = await cards(server, ada.cookie)
    expect(card?.title).toBe('Looking for a lift from Göteborg')
    expect(card?.body).toBe('Friday afternoon')
    expect(card?.entries.map((entry) => [entry.kind, entry.author?.name, entry.body])).toEqual([
      ['added', 'Ada', 'is looking for a lift'],
    ])
  })

  it('puts the seats and the notes on the card of an offer', async () => {
    const server = await build()
    await givenEvent()
    const ada = await givenAccount()
    await givenComing(ada.id)

    await post(server, ada.cookie, { ...A_JOURNEY, kind: 'offers', seats: 3, notes: 'Two bags max' })

    const [card] = await cards(server, ada.cookie)
    expect(card?.title).toBe('Offering a lift from Göteborg')
    expect(card?.body).toBe('Friday afternoon · 3 seats\n\nTwo bags max')
    expect(card?.entries.map((entry) => entry.body)).toEqual(['is offering a lift'])
  })

  it('is one thing on the feed rather than two, since one journey is one thing', async () => {
    const server = await build()
    await givenEvent()
    const ada = await givenAccount()
    await givenComing(ada.id)

    await post(server, ada.cookie)

    expect(await cards(server, ada.cookie)).toHaveLength(1)
  })

  it('links the card to the journey on the rideshare board', async () => {
    const server = await build()
    await givenEvent()
    const ada = await givenAccount()
    await givenComing(ada.id)

    const made = await post(server, ada.cookie)

    expect((await cards(server, ada.cookie))[0]?.link).toBe(
      `/rides?burn=${OPEN_BURN}&ride=${made.json().ride.id}`,
    )
  })

  it('carries the card’s id on the list, so the board can open the conversation', async () => {
    const server = await build()
    await givenEvent()
    const ada = await givenAccount()
    await givenComing(ada.id)
    await post(server, ada.cookie)

    const [card] = await cards(server, ada.cookie)

    expect(await threadOf(server, ada.cookie)).toBe(card?.id)
  })

  it('tells whoever is coming that somebody is looking for a lift, and never the poster', async () => {
    const server = await build()
    await givenEvent()
    const ada = await givenAccount(['member'], { name: 'Ada' })
    const bea = await givenAccount(['member'], { name: 'Bea' })
    await givenComing(ada.id)
    await givenComing(bea.id)
    await setOn(server, ada.cookie, ['ride_posted'])
    await setOn(server, bea.cookie, ['ride_posted'])

    await post(server, ada.cookie)

    expect((await bell(server, bea.cookie)).map((one) => one.body)).toEqual([
      'Ada is looking for a lift from Göteborg',
    ])
    expect(await bell(server, ada.cookie)).toEqual([])
  })

  it('says instead that somebody is offering one, when that is what it is', async () => {
    const server = await build()
    await givenEvent()
    const ada = await givenAccount(['member'], { name: 'Ada' })
    const bea = await givenAccount(['member'], { name: 'Bea' })
    await givenComing(ada.id)
    await givenComing(bea.id)
    await setOn(server, bea.cookie, ['ride_posted'])

    await post(server, ada.cookie, { ...A_JOURNEY, kind: 'offers', seats: 3 })

    expect((await bell(server, bea.cookie)).map((one) => one.body)).toEqual([
      'Ada is offering a lift from Göteborg',
    ])
  })

  it('tells nobody who is not coming to that burn, however they have set the switch', async () => {
    const server = await build()
    await givenEvent()
    const ada = await givenAccount(['member'], { name: 'Ada' })
    const bea = await givenAccount(['member'], { name: 'Bea' })
    await givenComing(ada.id)
    await setOn(server, bea.cookie, ['ride_posted'])

    await post(server, ada.cookie)

    expect(await bell(server, bea.cookie)).toEqual([])
  })

  it('writes one line for a change, none for a save that changed nothing, and coalesces the rest', async () => {
    const server = await build()
    await givenEvent()
    const ada = await givenAccount()
    await givenComing(ada.id)
    const id = (await post(server, ada.cookie)).json().ride.id

    await patch(server, ada.cookie, id, {})
    await patch(server, ada.cookie, id, { when: 'Friday afternoon' })
    expect((await cards(server, ada.cookie))[0]?.entries).toHaveLength(1)

    await patch(server, ada.cookie, id, { when: 'Saturday morning' })
    expect((await cards(server, ada.cookie))[0]?.entries.map((entry) => entry.kind)).toEqual([
      'added',
      'edited',
    ])

    await patch(server, ada.cookie, id, { notes: 'Two bags max' })
    expect((await cards(server, ada.cookie))[0]?.entries).toHaveLength(2)
  })

  it('takes the card off the feed when the journey is taken down', async () => {
    const server = await build()
    await givenEvent()
    const ada = await givenAccount()
    await givenComing(ada.id)
    const id = (await post(server, ada.cookie)).json().ride.id
    const [card] = await cards(server, ada.cookie)

    await remove(server, ada.cookie, id)

    expect(await cards(server, ada.cookie)).toEqual([])
    expect(
      (
        await server.inject({
          method: 'GET',
          url: `/api/threads/${card?.id ?? ''}`,
          headers: { cookie: ada.cookie },
        })
      ).statusCode,
    ).toBe(404)
  })

  it('says the journey is the poster’s to change, and nobody else’s', async () => {
    const server = await build()
    await givenEvent()
    const ada = await givenAccount(['member'], { name: 'Ada' })
    const bea = await givenAccount(['member'], { name: 'Bea' })
    await givenComing(ada.id)
    await givenComing(bea.id)
    await post(server, ada.cookie)

    expect((await cards(server, ada.cookie))[0]?.own).toBe(true)
    expect((await cards(server, bea.cookie))[0]?.own).toBe(false)
  })
})

describe('talking about a journey', () => {
  it('tells the poster, and the rest only if they asked, and never the one who said it', async () => {
    const server = await build()
    await givenEvent()
    const ada = await givenAccount(['member'], { name: 'Ada' })
    const bea = await givenAccount(['member'], { name: 'Bea' })
    const cai = await givenAccount(['member'], { name: 'Cai' })
    for (const who of [ada, bea, cai]) await givenComing(who.id)
    await setOn(server, cai.cookie, ['ride_comment_any'])
    const made = await post(server, ada.cookie)
    const threadId = await threadOf(server, ada.cookie)

    await say(server, bea.cookie, threadId, 'I could take you')

    expect((await bell(server, ada.cookie))[0]).toMatchObject({
      category: 'ride_comment',
      link: `/rides?burn=${OPEN_BURN}&ride=${made.json().ride.id}`,
    })
    expect((await bell(server, cai.cookie)).map((one) => one.category)).toEqual(['ride_comment_any'])
    expect(await bell(server, bea.cookie)).toEqual([])
  })

  it('tells the poster about a heart on their journey, and nobody about their own', async () => {
    const server = await build()
    await givenEvent()
    const ada = await givenAccount(['member'], { name: 'Ada' })
    const bea = await givenAccount(['member'], { name: 'Bea' })
    await givenComing(ada.id)
    await givenComing(bea.id)
    await post(server, ada.cookie)
    const threadId = await threadOf(server, ada.cookie)

    await heart(server, ada.cookie, threadId)
    expect(await bell(server, ada.cookie)).toEqual([])

    await heart(server, bea.cookie, threadId)

    expect((await bell(server, ada.cookie)).map((one) => [one.category, one.body])).toEqual([
      ['hearted', 'Bea hearts Looking for a lift from Göteborg'],
    ])
  })
})
