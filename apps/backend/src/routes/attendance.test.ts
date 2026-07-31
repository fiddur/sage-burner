import type { FastifyInstance, LightMyRequestResponse } from 'fastify'

import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, attendance, event } from '../db/schema.ts'
import { isAlreadyJoined } from './attendance.ts'
import { SESSION_COOKIE } from './auth.ts'

/**
 * Saying you are coming to a burn.
 *
 * Being in the community and coming to a burn are separate acts, so the
 * properties worth proving are that a community member can say it for
 * themselves, that saying it twice changes nothing, that an organiser can say it
 * for someone, and that a stranger cannot say it at all.
 */

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

const build = async (now: () => Date = () => new Date(NOW)) => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: SECRET }),
    now,
  })
  return app
}

const db = () => {
  const found = handle?.db
  if (found === undefined) throw new Error('build() first')
  return found
}

const cookieFor = (id: string) => {
  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return `${SESSION_COOKIE}=${sessions.issue(id)}`
}

const givenAccount = async (roles: ('admin' | 'member')[]) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  return { id, cookie: cookieFor(id) }
}

const givenEvent = async (over: { end_date?: string; slug?: string } = {}) => {
  const id = randomUUID()
  await db()
    .insert(event)
    .values({
      id,
      name: 'Summer burn',
      slug: over.slug ?? `burn-${id.slice(0, 8)}`,
      start_date: '2026-08-01',
      end_date: over.end_date ?? '2026-08-05',
      member_cap: 42,
      created_at: NOW,
    })
  return id
}

const mine = (server: FastifyInstance, cookie: string): Promise<LightMyRequestResponse> =>
  server.inject({ method: 'GET', url: '/api/events/active/attendance', headers: { cookie } })

const join = (server: FastifyInstance, cookie: string): Promise<LightMyRequestResponse> =>
  server.inject({ method: 'POST', url: '/api/events/active/attendance', headers: { cookie } })

const withdraw = (server: FastifyInstance, cookie: string): Promise<LightMyRequestResponse> =>
  server.inject({ method: 'DELETE', url: '/api/events/active/attendance', headers: { cookie } })

describe('a member saying they are coming', () => {
  it('starts out not coming, but knows which burn is open', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])

    const response = await mine(server, member.cookie)

    expect(response.statusCode).toBe(200)
    expect(response.json().event.name).toBe('Summer burn')
    expect(response.json().attendance).toBeNull()
  })

  it('creates the row, unpaid, when they say so', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenAccount(['member'])

    const response = await join(server, member.cookie)

    expect(response.statusCode).toBe(201)
    expect(response.json().attendance.payment_status).toBe('unpaid')
    expect(response.json().attendance.event_id).toBe(eventId)
    expect(response.json().attendance.joined_at).toBe(NOW)
  })

  it('is a no-op said twice, rather than an error or a second row', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])

    const first = await join(server, member.cookie)
    const second = await join(server, member.cookie)

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(200)
    expect(second.json().attendance.id).toBe(first.json().attendance.id)
    expect(await db().select().from(attendance)).toHaveLength(1)
  })

  it('is still a no-op when the two requests are concurrent', async () => {
    // The sequential test above passes even without a unique-constraint catch,
    // because the first request has finished before the second reads. This is the
    // case the comment in the route actually describes — a double click — and it
    // is the one that reached the insert twice and answered 500.
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])

    const [first, second] = await Promise.all([join(server, member.cookie), join(server, member.cookie)])

    expect([first.statusCode, second.statusCode].toSorted()).toEqual([200, 201])
    expect(await db().select().from(attendance)).toHaveLength(1)
  })

  it('is a no-op for two concurrent organiser adds too', async () => {
    // The admin route has the same check-then-insert, so it needs its own case:
    // pairing it with a member's join does not reliably interleave, and passed
    // whether or not the admin branch caught the violation.
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    const member = await givenAccount(['member'])

    const add = () =>
      server.inject({
        method: 'POST',
        url: `/api/admin/events/${eventId}/attendance`,
        headers: { cookie: admin.cookie },
        payload: { account_id: member.id },
      })

    const [first, second] = await Promise.all([add(), add()])

    expect([first.statusCode, second.statusCode].toSorted()).toEqual([200, 201])
    expect(await db().select().from(attendance)).toHaveLength(1)
  })

  it('shows up afterwards', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])

    await join(server, member.cookie)

    expect((await mine(server, member.cookie)).json().attendance).not.toBeNull()
  })

  it('lets them withdraw while they have paid nothing', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])
    await join(server, member.cookie)

    expect((await withdraw(server, member.cookie)).statusCode).toBe(204)
    expect(await db().select().from(attendance)).toHaveLength(0)
  })

  it('refuses to withdraw once something has been paid', async () => {
    // What a refund means is a real decision, and #31 owns it. Deleting the row
    // here would discard the record that money changed hands.
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])
    await join(server, member.cookie)
    await db().update(attendance).set({ payment_status: 'paid' })

    expect((await withdraw(server, member.cookie)).statusCode).toBe(409)
    expect(await db().select().from(attendance)).toHaveLength(1)
  })

  it('answers 404 when they were never coming', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])

    expect((await withdraw(server, member.cookie)).statusCode).toBe(404)
  })

  it('says there is no burn open rather than inventing one', async () => {
    const server = await build()
    const member = await givenAccount(['member'])

    const response = await mine(server, member.cookie)

    expect(response.json().event).toBeNull()
    expect((await join(server, member.cookie)).statusCode).toBe(409)
  })

  it('picks the soonest-ending burn that has not ended', async () => {
    const server = await build()
    await givenEvent({ end_date: '2027-01-05', slug: 'later' })
    const sooner = await givenEvent({ end_date: '2026-08-05', slug: 'sooner' })
    const member = await givenAccount(['member'])

    await join(server, member.cookie)

    expect((await db().select().from(attendance))[0]?.event_id).toBe(sooner)
  })
})

describe('who may say it', () => {
  it('refuses an anonymous caller on every route', async () => {
    const server = await build()
    await givenEvent()

    for (const [method, url] of [
      ['GET', '/api/events/active/attendance'],
      ['POST', '/api/events/active/attendance'],
      ['DELETE', '/api/events/active/attendance'],
    ] as const) {
      expect((await server.inject({ method, url })).statusCode, url).toBe(401)
    }
  })

  it('refuses an account that is not a member of the community', async () => {
    // An account with no roles exists — someone invited but not yet redeemed, or
    // an admin-only bootstrap account. Being able to sign in is not being a member.
    const server = await build()
    await givenEvent()
    const stranger = await givenAccount([])

    expect((await join(server, stranger.cookie)).statusCode).toBe(403)
    expect(await db().select().from(attendance)).toHaveLength(0)
  })

  it('refuses an admin who is not also a member', async () => {
    // The two roles are separate rows, and redemption grants only `member`, so an
    // admin is not automatically one.
    const server = await build()
    await givenEvent()
    const admin = await givenAccount(['admin'])

    expect((await join(server, admin.cookie)).statusCode).toBe(403)
  })
})

describe('an organiser saying it for someone', () => {
  const add = (server: FastifyInstance, cookie: string, eventId: string, accountId: string) =>
    server.inject({
      method: 'POST',
      url: `/api/admin/events/${eventId}/attendance`,
      headers: { cookie },
      payload: { account_id: accountId },
    })

  const remove = (server: FastifyInstance, cookie: string, eventId: string, accountId: string) =>
    server.inject({
      method: 'DELETE',
      url: `/api/admin/events/${eventId}/attendance/${accountId}`,
      headers: { cookie },
    })

  it('adds an account that never opted in', async () => {
    // People ask over Discord, and an organiser should not have to talk them
    // through a UI to say yes.
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    const member = await givenAccount(['member'])

    const response = await add(server, admin.cookie, eventId, member.id)

    expect(response.statusCode).toBe(201)
    expect(response.json().attendance.account_id).toBe(member.id)
  })

  it('is a no-op when they were already coming', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    const member = await givenAccount(['member'])
    await join(server, member.cookie)

    expect((await add(server, admin.cookie, eventId, member.id)).statusCode).toBe(200)
    expect(await db().select().from(attendance)).toHaveLength(1)
  })

  it('removes someone, even if they have paid', async () => {
    // Unlike the member's own withdrawal: an organiser undoing a mistaken add
    // needs to be able to, and they are making the call deliberately.
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    const member = await givenAccount(['member'])
    await join(server, member.cookie)
    await db().update(attendance).set({ payment_status: 'paid' })

    expect((await remove(server, admin.cookie, eventId, member.id)).statusCode).toBe(204)
    expect(await db().select().from(attendance)).toHaveLength(0)
  })

  it('answers 404 for an account or an event that does not exist', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    const member = await givenAccount(['member'])

    expect((await add(server, admin.cookie, eventId, randomUUID())).statusCode).toBe(404)
    expect((await add(server, admin.cookie, randomUUID(), member.id)).statusCode).toBe(404)
    expect((await remove(server, admin.cookie, eventId, member.id)).statusCode).toBe(404)
  })

  it('refuses a member trying to add someone else', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenAccount(['member'])
    const other = await givenAccount(['member'])

    expect((await add(server, member.cookie, eventId, other.id)).statusCode).toBe(403)
    expect(await db().select().from(attendance)).toHaveLength(0)
  })

  it('refuses an anonymous caller', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenAccount(['member'])

    const response = await server.inject({
      method: 'POST',
      url: `/api/admin/events/${eventId}/attendance`,
      payload: { account_id: member.id },
    })

    expect(response.statusCode).toBe(401)
  })

  it('refuses an unrecognised key rather than dropping it', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    const member = await givenAccount(['member'])

    const response = await server.inject({
      method: 'POST',
      url: `/api/admin/events/${eventId}/attendance`,
      headers: { cookie: admin.cookie },
      payload: { account_id: member.id, payment_status: 'paid' },
    })

    expect(response.statusCode).toBe(400)
  })
})

describe('one row per person per burn', () => {
  it('lets the same person come to two different burns', async () => {
    const server = await build()
    const first = await givenEvent({ end_date: '2026-08-05', slug: 'first' })
    const admin = await givenAccount(['admin'])
    const member = await givenAccount(['member'])
    await join(server, member.cookie)

    const second = await givenEvent({ end_date: '2027-01-05', slug: 'second' })
    const response = await server.inject({
      method: 'POST',
      url: `/api/admin/events/${second}/attendance`,
      headers: { cookie: admin.cookie },
      payload: { account_id: member.id },
    })

    expect(response.statusCode).toBe(201)
    const rows = await db().select().from(attendance).where(eq(attendance.account_id, member.id))
    expect(rows.map((row) => row.event_id).toSorted()).toEqual([first, second].toSorted())
  })
})

describe('isAlreadyJoined', () => {
  it('matches what the database actually throws, not what I assumed it throws', async () => {
    // The regex is the fragile part: an index rename or a driver change alters
    // the message and the catch silently stops catching, turning a double click
    // back into a 500. So the error comes from a real violation rather than a
    // string literal.
    await build()
    const eventId = await givenEvent()
    const member = await givenAccount(['member'])
    const row = {
      event_id: eventId,
      account_id: member.id,
      joined_at: NOW,
      payment_status: 'unpaid' as const,
    }
    await db()
      .insert(attendance)
      .values({ id: randomUUID(), ...row })

    const thrown = await db()
      .insert(attendance)
      .values({ id: randomUUID(), ...row })
      .then(() => undefined)
      .catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(Error)
    expect(isAlreadyJoined(thrown)).toBe(true)
  })

  it('does not match an unrelated failure', async () => {
    expect(isAlreadyJoined(new Error('UNIQUE constraint failed: account.email'))).toBe(false)
    expect(isAlreadyJoined(new Error('FOREIGN KEY constraint failed'))).toBe(false)
    expect(isAlreadyJoined(undefined)).toBe(false)
  })
})
