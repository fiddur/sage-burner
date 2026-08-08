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
import { account, accountRole, event, ride } from '../db/schema.ts'

/**
 * Getting to the burn and back (#26).
 *
 * Two properties carry most of these: a journey is **yours** to change, unlike the
 * lanes or the register beside it, and the contact on the board is the account's
 * rather than a copy taken when the row was written.
 */

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

describe('the rideshare board', () => {
  it('keeps both halves in one list, each saying which it is', async () => {
    // By kind rather than by position. The clock is fixed here, so two rows posted in
    // one test share a `created_at` and the order falls to the random id behind it —
    // an assertion on position passes or fails by coin toss, which mutation testing
    // is how this was found.
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
    // The one ordering worth pinning, and it needs two distinct times to mean
    // anything — so these are written straight in rather than posted through a fixed
    // clock that would give them the same one.
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
    // The whole reason there is no contact column: a number changed on the details
    // page changes on every lift that person has offered.
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
    // Neither is offered in the body: a request naming either would be a second,
    // disagreeing opinion about whose journey this is and which burn it is to.
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
    // The register and the grid are the burn's shared furniture and anyone may
    // rearrange them. This is somebody's own statement about their own travel, and it
    // carries their contact.
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
    // The board of a finished burn is the record of who travelled with whom.
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
    // An organiser who is not attending may still read the board and post their own
    // journey — the same rule the timetable follows (#200).
    expect((await list(server, organiser.cookie)).statusCode).toBe(200)
    expect((await post(server, organiser.cookie)).statusCode).toBe(201)
  })

  it('goes when the burn does, and when the person does', async () => {
    const server = await build()
    await givenEvent()
    const ada = await givenAccount()
    await post(server, ada.cookie)

    await db().delete(account).where(eq(account.id, ada.id))

    expect(await db().select().from(ride)).toEqual([])
  })

  it('refuses a half of the board the vocabulary has never heard of', async () => {
    // The CHECK, proved by a write that skips the API — the migration's, not the
    // schema's, since the test database is built from the SQL.
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
    // The schema refuses these at the boundary; these are the same rules where a
    // hand-edited database or a future route cannot get round them.
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
    // The passing sibling: an ordinary row goes in, so the three above fail for the
    // rule each names rather than for a column list that never worked.
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
