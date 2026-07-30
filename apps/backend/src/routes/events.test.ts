import type { FastifyInstance } from 'fastify'

import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, event } from '../db/schema.ts'
import { SESSION_COOKIE } from './auth.ts'

/**
 * Events, and the rule for which one is "active".
 *
 * The clock is injected throughout — an active-event rule tested against the
 * real date passes in July and fails in September, which is the worst kind of
 * test to own.
 */

const SECRET = 's'.repeat(40)

let handle: DbHandle | undefined
let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  handle?.close()
  app = undefined
  handle = undefined
})

const build = async (today = '2026-06-01') => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: SECRET }),
    now: () => new Date(`${today}T12:00:00.000Z`),
  })
  return app
}

const db = () => {
  const found = handle?.db
  if (found === undefined) throw new Error('build() first')
  return found
}

const givenAdmin = async () => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({
      id,
      email: `${id}@example.org`,
      password_hash: null,
      created_at: '2026-01-01T00:00:00.000Z',
    })
  await db().insert(accountRole).values({ account_id: id, role: 'admin' })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return `${SESSION_COOKIE}=${sessions.issue(id)}`
}

const givenEvent = async (fields: { slug: string; start_date: string; end_date: string; name?: string }) => {
  const id = randomUUID()
  await db()
    .insert(event)
    .values({
      id,
      name: fields.name ?? fields.slug,
      slug: fields.slug,
      start_date: fields.start_date,
      end_date: fields.end_date,
      welcome_markdown: '',
      member_cap: 42,
      created_at: '2026-01-01T00:00:00.000Z',
    })
  return id
}

const active = (server: FastifyInstance) => server.inject({ method: 'GET', url: '/api/events/active' })

const create = (server: FastifyInstance, cookie: string, payload: Record<string, unknown>) =>
  server.inject({ method: 'POST', url: '/api/admin/events', headers: { cookie }, payload })

const patch = (server: FastifyInstance, cookie: string, id: string, payload: Record<string, unknown>) =>
  server.inject({ method: 'PATCH', url: `/api/admin/events/${id}`, headers: { cookie }, payload })

const valid = {
  name: 'Summer Burn 2026',
  slug: 'summer-2026',
  start_date: '2026-08-01',
  end_date: '2026-08-05',
  member_cap: 42,
}

describe('GET /api/events/active', () => {
  it('is null before any event exists', async () => {
    // A fresh deployment. Not a 404 — the homepage renders an explanation.
    const server = await build()

    const response = await active(server)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ event: null })
  })

  it('is reachable signed out', async () => {
    const server = await build()
    await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    expect((await active(server)).statusCode).toBe(200)
  })

  it('picks the soonest-ending event that has not ended', async () => {
    const server = await build('2026-06-01')
    await givenEvent({ slug: 'winter-2026', start_date: '2026-12-01', end_date: '2026-12-05' })
    await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    expect((await active(server)).json().event.slug).toBe('summer-2026')
  })

  it('still counts an event that is running today', async () => {
    // Mid-burn is exactly when the homepage matters most; a rule keyed on the
    // start date would have dropped it the moment it began.
    const server = await build('2026-08-03')
    await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    expect((await active(server)).json().event.slug).toBe('summer-2026')
  })

  it('still counts an event ending today', async () => {
    const server = await build('2026-08-05')
    await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    expect((await active(server)).json().event.slug).toBe('summer-2026')
  })

  it('is null once every event has ended', async () => {
    // Deliberate: last year's welcome text must not stay up as though it were
    // an invitation. Creating the next event is what fills the gap.
    const server = await build('2026-08-06')
    await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    expect((await active(server)).json()).toEqual({ event: null })
  })

  it('breaks a tie deterministically', async () => {
    const server = await build('2026-06-01')
    await givenEvent({ slug: 'b-burn', start_date: '2026-08-02', end_date: '2026-08-05' })
    await givenEvent({ slug: 'a-burn', start_date: '2026-08-01', end_date: '2026-08-05' })

    // Same end date, so the earlier start wins.
    expect((await active(server)).json().event.slug).toBe('a-burn')
  })

  it('is marked no-cache so an edit is not served stale', async () => {
    const server = await build()

    expect((await active(server)).headers['cache-control']).toBe('no-cache')
  })
})

describe('admin event routes', () => {
  it('refuse anyone who is not an admin', async () => {
    const server = await build()

    expect((await server.inject({ method: 'GET', url: '/api/admin/events' })).statusCode).toBe(401)
    expect(
      (await server.inject({ method: 'POST', url: '/api/admin/events', payload: valid })).statusCode,
    ).toBe(401)
  })

  it('create an event and return it', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    const response = await create(server, cookie, valid)

    expect(response.statusCode).toBe(201)
    expect(response.json().event).toMatchObject({ slug: 'summer-2026', member_cap: 42 })
    expect(response.json().event.id).toBeTruthy()
  })

  it('default the welcome text to empty so an event can exist before it is written', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    const response = await create(server, cookie, valid)

    expect(response.json().event.welcome_markdown).toBe('')
  })

  it('reject a duplicate slug with 409 rather than 500', async () => {
    // The slug is in URLs, so this is a thing the organiser fixes by picking
    // another — it needs to be distinguishable from a server fault.
    const server = await build()
    const cookie = await givenAdmin()
    await create(server, cookie, valid)

    const response = await create(server, cookie, { ...valid, name: 'Another' })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'conflict' })
  })

  it('reject an end date before the start date', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    const response = await create(server, cookie, {
      ...valid,
      start_date: '2026-08-05',
      end_date: '2026-08-01',
    })

    expect(response.statusCode).toBe(400)
  })

  it('list events by start date', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    await givenEvent({ slug: 'winter-2026', start_date: '2026-12-01', end_date: '2026-12-05' })
    await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    const response = await server.inject({ method: 'GET', url: '/api/admin/events', headers: { cookie } })

    expect(response.json().events.map((row: { slug: string }) => row.slug)).toEqual([
      'summer-2026',
      'winter-2026',
    ])
  })

  it('edit the welcome text without restating the event', async () => {
    // The whole point of #11: an organiser changes the welcome text and the
    // public page reflects it, with no redeploy and no risk of clobbering the
    // dates someone else just fixed.
    const server = await build('2026-06-01')
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    const response = await patch(server, cookie, id, { welcome_markdown: '# Welcome, bring water' })

    expect(response.statusCode).toBe(200)
    expect((await active(server)).json().event.welcome_markdown).toBe('# Welcome, bring water')
  })

  it('leave untouched fields alone', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    await patch(server, cookie, id, { welcome_markdown: 'hello' })

    const [row] = await db().select().from(event)
    expect(row).toMatchObject({ slug: 'summer-2026', start_date: '2026-08-01', member_cap: 42 })
  })

  it('reject a patch that moves one date past the other', async () => {
    // The schema cannot catch this: it has to tolerate a partial range, since a
    // PATCH may legitimately carry only one date. Without the merged-range
    // check this reaches the database CHECK and answers 500.
    const server = await build()
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    const response = await patch(server, cookie, id, { start_date: '2026-09-01' })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'bad_request' })
  })

  it('answer 404 for an event that does not exist', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    const response = await patch(server, cookie, randomUUID(), { welcome_markdown: 'x' })

    expect(response.statusCode).toBe(404)
  })

  it('keep the roster of events out of caches', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    const response = await server.inject({ method: 'GET', url: '/api/admin/events', headers: { cookie } })

    expect(response.headers['cache-control']).toBe('no-store')
  })
})
