import type { FastifyInstance, LightMyRequestResponse } from 'fastify'

import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, attendance, event } from '../db/schema.ts'
import { isAlreadyJoined } from './attendance.ts'

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

const givenAccount = async (roles: ('admin' | 'member')[], name: string | null = null) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, name, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  return { id, cookie: cookieFor(id) }
}

const givenEvent = async (over: { start_date?: string; end_date?: string; slug?: string } = {}) => {
  const id = randomUUID()
  await db()
    .insert(event)
    .values({
      id,
      name: 'Summer burn',
      slug: over.slug ?? `burn-${id.slice(0, 8)}`,
      start_date: over.start_date ?? '2026-08-01',
      end_date: over.end_date ?? '2026-08-05',
      member_cap: 42,
      created_at: NOW,
    })
  return id
}

const myBurns = (server: FastifyInstance, cookie: string): Promise<LightMyRequestResponse> =>
  server.inject({ method: 'GET', url: '/api/events/mine', headers: { cookie } })

const join = (server: FastifyInstance, cookie: string, eventId: string): Promise<LightMyRequestResponse> =>
  server.inject({ method: 'POST', url: `/api/events/${eventId}/attendance/me`, headers: { cookie } })

const withdraw = (
  server: FastifyInstance,
  cookie: string,
  eventId: string,
): Promise<LightMyRequestResponse> =>
  server.inject({ method: 'DELETE', url: `/api/events/${eventId}/attendance/me`, headers: { cookie } })

/** This account's stay at one burn, read back the way their own page reads it. */
const stayAt = async (server: FastifyInstance, cookie: string, eventId: string) => {
  const body = (await myBurns(server, cookie)).json()
  const found = [...body.coming, ...body.past].find(
    (burn: { event: { id: string } }) => burn.event.id === eventId,
  )

  return found?.attendance ?? null
}

describe('a member saying they are coming', () => {
  it('lists a burn they have not joined, with no stay against it', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenAccount(['member'])

    const response = await myBurns(server, member.cookie)

    expect(response.statusCode).toBe(200)
    const { coming, past } = response.json()
    expect(coming).toHaveLength(1)
    expect(coming[0].event.id).toBe(eventId)
    expect(coming[0].event.name).toBe('Summer burn')
    expect(coming[0].attendance).toBeNull()
    expect(past).toEqual([])
  })

  it('creates the row, unpaid, when they say so', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenAccount(['member'])

    const response = await join(server, member.cookie, eventId)

    expect(response.statusCode).toBe(201)
    expect(response.json().attendance.payment_status).toBe('unpaid')
    expect(response.json().attendance.event_id).toBe(eventId)
    expect(response.json().attendance.joined_at).toBe(NOW)
  })

  it('is a no-op said twice, rather than an error or a second row', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenAccount(['member'])

    const first = await join(server, member.cookie, eventId)
    const second = await join(server, member.cookie, eventId)

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
    const eventId = await givenEvent()
    const member = await givenAccount(['member'])

    const [first, second] = await Promise.all([
      join(server, member.cookie, eventId),
      join(server, member.cookie, eventId),
    ])

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
    const eventId = await givenEvent()
    const member = await givenAccount(['member'])

    await join(server, member.cookie, eventId)

    expect(await stayAt(server, member.cookie, eventId)).not.toBeNull()
  })

  it('lets them withdraw while they have paid nothing', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenAccount(['member'])
    await join(server, member.cookie, eventId)

    expect((await withdraw(server, member.cookie, eventId)).statusCode).toBe(204)
    expect(await db().select().from(attendance)).toHaveLength(0)
  })

  it('refuses to withdraw once something has been paid', async () => {
    // What a refund means is a real decision, and #31 owns it. Deleting the row
    // here would discard the record that money changed hands.
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenAccount(['member'])
    await join(server, member.cookie, eventId)
    await db().update(attendance).set({ payment_status: 'paid' })

    expect((await withdraw(server, member.cookie, eventId)).statusCode).toBe(409)
    expect(await db().select().from(attendance)).toHaveLength(1)
  })

  it('answers 404 when they were never coming', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenAccount(['member'])

    expect((await withdraw(server, member.cookie, eventId)).statusCode).toBe(404)
  })

  it('offers nothing when there are no burns at all', async () => {
    const server = await build()
    const member = await givenAccount(['member'])

    expect((await myBurns(server, member.cookie)).json()).toEqual({ coming: [], past: [] })
  })

  it('joins the burn it was told to, not whichever one is next', async () => {
    // The whole reason these routes stopped being scoped to the active burn: the
    // details page lists every burn still to come, and the second one on it is by
    // definition not the soonest-ending.
    const server = await build()
    const sooner = await givenEvent({ end_date: '2026-08-05', slug: 'sooner' })
    const later = await givenEvent({ end_date: '2027-01-05', slug: 'later' })
    const member = await givenAccount(['member'])

    expect((await join(server, member.cookie, later)).statusCode).toBe(201)
    expect((await db().select().from(attendance)).map((row) => row.event_id)).toEqual([later])
    expect(await stayAt(server, member.cookie, sooner)).toBeNull()
  })

  it('refuses a burn that has ended, and one that never existed, alike', async () => {
    // The same answer for both on purpose: telling them apart would confirm to an
    // unrelated caller that an id is real.
    const server = await build()
    const gone = await givenEvent({ start_date: '2025-08-01', end_date: '2025-08-05', slug: 'gone' })
    const member = await givenAccount(['member'])

    expect((await join(server, member.cookie, gone)).statusCode).toBe(404)
    expect((await join(server, member.cookie, randomUUID())).statusCode).toBe(404)
    expect((await withdraw(server, member.cookie, gone)).statusCode).toBe(404)
    expect(await db().select().from(attendance)).toHaveLength(0)
  })

  it('offers the burns to an organiser holding admin without member', async () => {
    // What fills the selector. That account has no attendance anywhere, so under
    // `requireMember` it got a 403 and faced an empty selector on the burn it was
    // setting up — the one case `choosableBurns(true, …)` exists for.
    const server = await build()
    const eventId = await givenEvent()
    const organiser = await givenAccount(['admin'])

    const response = await myBurns(server, organiser.cookie)

    expect(response.statusCode).toBe(200)
    expect(response.json().coming).toHaveLength(1)
    expect(response.json().coming[0].event.id).toBe(eventId)
    expect(response.json().coming[0].attendance).toBeNull()
    expect(response.json().past).toEqual([])
  })

  it('still refuses an account with neither role, which has nothing to choose', async () => {
    const server = await build()
    await givenEvent()
    const applicant = await givenAccount([])

    expect((await myBurns(server, applicant.cookie)).statusCode).toBe(403)
  })

  it('lists the coming burns soonest first, and past ones only if they came', async () => {
    const server = await build()
    const gone = await givenEvent({ start_date: '2025-08-01', end_date: '2025-08-05', slug: 'gone' })
    const missed = await givenEvent({ start_date: '2024-08-01', end_date: '2024-08-05', slug: 'missed' })
    const later = await givenEvent({ start_date: '2027-01-01', end_date: '2027-01-05', slug: 'later' })
    const sooner = await givenEvent({ end_date: '2026-08-05', slug: 'sooner' })
    const member = await givenAccount(['member'])
    await db().insert(attendance).values({
      id: randomUUID(),
      event_id: gone,
      account_id: member.id,
      joined_at: '2025-07-01T00:00:00.000Z',
      payment_status: 'paid',
    })

    const { coming, past } = (await myBurns(server, member.cookie)).json()

    expect(coming.map((burn: { event: { id: string } }) => burn.event.id)).toEqual([sooner, later])
    // `missed` is a real burn and not on this list: nobody's history includes a
    // burn they did not come to.
    expect(past.map((burn: { event: { id: string } }) => burn.event.id)).toEqual([gone])
    expect(missed).not.toBe(gone)
  })
})

describe('who may say it', () => {
  it('refuses an anonymous caller on every route', async () => {
    const server = await build()
    const eventId = await givenEvent()

    for (const [method, url] of [
      ['GET', '/api/events/mine'],
      ['POST', `/api/events/${eventId}/attendance/me`],
      ['DELETE', `/api/events/${eventId}/attendance/me`],
      ['PATCH', `/api/events/${eventId}/attendance/me`],
    ] as const) {
      expect((await server.inject({ method, url })).statusCode, url).toBe(401)
    }
  })

  it('refuses an account that is not a member of the community', async () => {
    // An account with no roles exists — someone invited but not yet redeemed, or
    // an admin-only bootstrap account. Being able to sign in is not being a member.
    const server = await build()
    const eventId = await givenEvent()
    const stranger = await givenAccount([])

    expect((await join(server, stranger.cookie, eventId)).statusCode).toBe(403)
    expect(await db().select().from(attendance)).toHaveLength(0)
  })

  it('refuses an admin who is not also a member', async () => {
    // The two roles are separate rows, and redemption grants only `member`, so an
    // admin is not automatically one.
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])

    expect((await join(server, admin.cookie, eventId)).statusCode).toBe(403)
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
    await join(server, member.cookie, eventId)

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
    await join(server, member.cookie, eventId)
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
    await join(server, member.cookie, first)

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

describe('the dates a stay starts with', () => {
  it('is the whole burn, so nobody types what the event already knows', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenAccount(['member'])

    const response = await join(server, member.cookie, eventId)

    expect(response.statusCode).toBe(201)
    expect(response.json().attendance).toMatchObject({
      arrival_date: '2026-08-01',
      departure_date: '2026-08-05',
    })
  })

  it('is the burn an organiser adds them to, too', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    const someone = await givenAccount(['member'])

    const response = await server.inject({
      method: 'POST',
      url: `/api/admin/events/${eventId}/attendance`,
      headers: { cookie: admin.cookie },
      payload: { account_id: someone.id },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().attendance).toMatchObject({
      arrival_date: '2026-08-01',
      departure_date: '2026-08-05',
    })
  })

  it('is still theirs to change afterwards', async () => {
    // A default, not a decision. Someone arriving a day late must be able to say
    // so, and the ordering rule still applies to what they say.
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenAccount(['member'])
    await join(server, member.cookie, eventId)

    const response = await server.inject({
      method: 'PATCH',
      url: `/api/events/${eventId}/attendance/me`,
      headers: { cookie: member.cookie },
      payload: { arrival_date: '2026-08-02' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().attendance.arrival_date).toBe('2026-08-02')
  })
})

describe('who is coming, by name', () => {
  const attendees = (server: FastifyInstance, cookie: string | undefined, eventId: string) =>
    server.inject({
      method: 'GET',
      url: `/api/events/${eventId}/attendees`,
      headers: cookie === undefined ? {} : { cookie },
    })

  it('names everyone on this burn and nobody from another', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const other = await givenEvent({ slug: 'other-burn' })
    const bea = await givenAccount(['member'], 'Bea')
    const ada = await givenAccount(['member'], 'Ada')
    const elsewhere = await givenAccount(['member'], 'Elsewhere')
    await join(server, bea.cookie, eventId)
    await join(server, ada.cookie, eventId)
    await db().insert(attendance).values({
      id: randomUUID(),
      event_id: other,
      account_id: elsewhere.id,
      joined_at: NOW,
      payment_status: 'unpaid',
    })

    const response = await attendees(server, ada.cookie, eventId)

    expect(response.statusCode).toBe(200)
    expect(response.json().attendees).toEqual([
      { account_id: ada.id, name: 'Ada', avatar: null },
      { account_id: bea.id, name: 'Bea', avatar: null },
    ])
  })

  it('carries no contact details, allergies or payment state', async () => {
    // The member roster carries those; this list is two columns on purpose, so
    // that widening one cannot widen the other.
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenAccount(['member'], 'Ada')
    await join(server, member.cookie, eventId)
    const stored = await db()
      .update(account)
      .set({ contact: 'ada#1234', allergies_notes: 'peanuts' })
      .where(eq(account.id, member.id))
      .returning({ contact: account.contact, allergies: account.allergies_notes })

    // Asserted, because a `set` naming a column that does not exist is a typecheck
    // error and nothing else — the rest of this test would then look for strings
    // that were never written and pass against any implementation.
    expect(stored).toEqual([{ contact: 'ada#1234', allergies: 'peanuts' }])

    const body = (await attendees(server, member.cookie, eventId)).body

    expect(body).not.toContain('ada#1234')
    expect(body).not.toContain('peanuts')
    expect(body).not.toContain('unpaid')
  })

  it('is for approved accounts, and an admin who is not attending is one', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const roleless = await givenAccount([])
    const organiser = await givenAccount(['admin'], 'Organiser')

    expect((await attendees(server, undefined, eventId)).statusCode).toBe(401)
    expect((await attendees(server, roleless.cookie, eventId)).statusCode).toBe(403)
    expect((await attendees(server, organiser.cookie, eventId)).statusCode).toBe(200)
  })

  it('is empty for a burn nobody has joined, and for one that does not exist', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenAccount(['member'], 'Ada')

    expect((await attendees(server, member.cookie, eventId)).json().attendees).toEqual([])
    expect((await attendees(server, member.cookie, randomUUID())).json().attendees).toEqual([])
  })
})
