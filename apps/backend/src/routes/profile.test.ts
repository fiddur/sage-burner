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
import { SESSION_COOKIE } from './auth.ts'

/**
 * A member maintaining their own record.
 *
 * The acceptance criterion is authorization: whose row gets written is derived
 * from the session and never from the request, so there is no id to guess. These
 * tests try to guess one anyway.
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

const givenMember = async (over: { name?: string; roles?: ('admin' | 'member')[] } = {}) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({
      id,
      email: `${id}@example.org`,
      password_hash: null,
      name: over.name ?? 'Someone',
      contact: 'someone@example.org',
      allergies_notes: null,
      created_at: NOW,
    })
  for (const role of over.roles ?? ['member']) {
    await db().insert(accountRole).values({ account_id: id, role })
  }

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

const givenComing = async (eventId: string, accountId: string) => {
  const id = randomUUID()
  await db()
    .insert(attendance)
    .values({ id, event_id: eventId, account_id: accountId, joined_at: NOW, payment_status: 'unpaid' })
  return id
}

const getProfile = (server: FastifyInstance, cookie: string) =>
  server.inject({ method: 'GET', url: '/api/me/profile', headers: { cookie } })

const patchProfile = (
  server: FastifyInstance,
  cookie: string,
  payload: Record<string, unknown>,
): Promise<LightMyRequestResponse> =>
  server.inject({ method: 'PATCH', url: '/api/me/profile', headers: { cookie }, payload })

const patchStay = (
  server: FastifyInstance,
  cookie: string,
  payload: Record<string, unknown>,
): Promise<LightMyRequestResponse> =>
  server.inject({
    method: 'PATCH',
    url: '/api/events/active/attendance',
    headers: { cookie },
    payload,
  })

describe('a member reading and editing who they are', () => {
  it('reads back their own details', async () => {
    const server = await build()
    const member = await givenMember()

    const response = await getProfile(server, member.cookie)

    expect(response.statusCode).toBe(200)
    expect(response.json().profile.name).toBe('Someone')
    expect(response.json().profile.account_id).toBe(member.id)
  })

  it('changes one field without clearing the others', async () => {
    const server = await build()
    const member = await givenMember()

    const response = await patchProfile(server, member.cookie, { allergies_notes: 'peanuts' })

    expect(response.statusCode).toBe(200)
    expect(response.json().profile.allergies_notes).toBe('peanuts')
    expect(response.json().profile.contact).toBe('someone@example.org')
  })

  it('never touches anyone else, whatever the body says', async () => {
    // The acceptance criterion. There is no id in the body to aim at, and adding
    // one is a 400 rather than a redirect of the write.
    const server = await build()
    const member = await givenMember()
    const other = await givenMember({ name: 'Someone Else' })

    const response = await patchProfile(server, member.cookie, {
      name: 'Changed',
      account_id: other.id,
    })

    expect(response.statusCode).toBe(400)
    const [row] = await db().select().from(account).where(eq(account.id, other.id))
    expect(row?.name).toBe('Someone Else')
  })

  it('refuses to set an empty name, since an organiser has to reach them', async () => {
    const server = await build()
    const member = await givenMember()

    expect((await patchProfile(server, member.cookie, { name: '   ' })).statusCode).toBe(400)
    expect((await patchProfile(server, member.cookie, { contact: '' })).statusCode).toBe(400)
  })

  it('treats an empty body as a no-op rather than a 500', async () => {
    // `set({})` is not valid SQL.
    const server = await build()
    const member = await givenMember()

    const response = await patchProfile(server, member.cookie, {})

    expect(response.statusCode).toBe(200)
    expect(response.json().profile.name).toBe('Someone')
  })

  it('refuses to change the login email here', async () => {
    // Changing the identity you sign in with is a different act, with
    // verification nothing implements yet.
    const server = await build()
    const member = await givenMember()

    expect((await patchProfile(server, member.cookie, { email: 'new@example.org' })).statusCode).toBe(400)
  })

  it('refuses an anonymous caller', async () => {
    const server = await build()

    expect((await server.inject({ method: 'GET', url: '/api/me/profile' })).statusCode).toBe(401)
    expect(
      (await server.inject({ method: 'PATCH', url: '/api/me/profile', payload: { name: 'x' } })).statusCode,
    ).toBe(401)
  })

  it('refuses an account that is not a member', async () => {
    const server = await build()
    const admin = await givenMember({ roles: ['admin'] })

    expect((await getProfile(server, admin.cookie)).statusCode).toBe(403)
  })
})

describe('a member editing their stay', () => {
  it('saves the details for the burn they are coming to', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    await givenComing(eventId, member.id)

    const response = await patchStay(server, member.cookie, {
      arrival_date: '2026-08-01',
      departure_date: '2026-08-05',
      lodging: 'Hammock in the barn',
      shift_preference: 'Sauna tending',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().attendance.lodging).toBe('Hammock in the barn')
    expect(response.json().attendance.arrival_date).toBe('2026-08-01')
  })

  it('refuses a departure before the arrival', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    await givenComing(eventId, member.id)

    const response = await patchStay(server, member.cookie, {
      arrival_date: '2026-08-05',
      departure_date: '2026-08-01',
    })

    expect(response.statusCode).toBe(400)
  })

  it('refuses a single date that inverts the stored pair', async () => {
    // The case the schema cannot see: the body carries one date, and the conflict
    // is only visible against the row. Composed into the WHERE rather than
    // compared after a read, so a concurrent write cannot slip between.
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    await givenComing(eventId, member.id)
    await patchStay(server, member.cookie, { arrival_date: '2026-08-01', departure_date: '2026-08-03' })

    const response = await patchStay(server, member.cookie, { departure_date: '2026-07-30' })

    expect(response.statusCode).toBe(400)
    const [row] = await db().select().from(attendance)
    expect(row?.departure_date).toBe('2026-08-03')
  })

  it('accepts a single date that does not invert it', async () => {
    // The passing sibling: the condition must not refuse an ordinary edit.
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    await givenComing(eventId, member.id)
    await patchStay(server, member.cookie, { arrival_date: '2026-08-01', departure_date: '2026-08-03' })

    const response = await patchStay(server, member.cookie, { departure_date: '2026-08-04' })

    expect(response.statusCode).toBe(200)
    expect(response.json().attendance.departure_date).toBe('2026-08-04')
  })

  it('lets a date be cleared', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    await givenComing(eventId, member.id)
    await patchStay(server, member.cookie, { arrival_date: '2026-08-01', departure_date: '2026-08-03' })

    const response = await patchStay(server, member.cookie, { departure_date: null })

    expect(response.statusCode).toBe(200)
    expect(response.json().attendance.departure_date).toBeNull()
  })

  it('refuses to let a member mark themselves paid', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    await givenComing(eventId, member.id)

    const response = await patchStay(server, member.cookie, { payment_status: 'paid' })

    expect(response.statusCode).toBe(400)
    const [row] = await db().select().from(attendance)
    expect(row?.payment_status).toBe('unpaid')
  })

  it('never touches another member’s stay', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    const other = await givenMember()
    await givenComing(eventId, member.id)
    const otherRow = await givenComing(eventId, other.id)

    await patchStay(server, member.cookie, { lodging: 'Mine' })

    const [row] = await db().select().from(attendance).where(eq(attendance.id, otherRow))
    expect(row?.lodging).toBeNull()
  })

  it('answers 404 when they are not coming to this burn', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenMember()

    expect((await patchStay(server, member.cookie, { lodging: 'Tent' })).statusCode).toBe(404)
  })

  it('answers 404 when no burn is open', async () => {
    const server = await build()
    const member = await givenMember()

    expect((await patchStay(server, member.cookie, { lodging: 'Tent' })).statusCode).toBe(404)
  })

  it('refuses an anonymous caller', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    await givenComing(eventId, member.id)

    const response = await server.inject({
      method: 'PATCH',
      url: '/api/events/active/attendance',
      payload: { lodging: 'Tent' },
    })

    expect(response.statusCode).toBe(401)
    const [row] = await db().select().from(attendance)
    expect(row?.lodging).toBeNull()
  })
})
