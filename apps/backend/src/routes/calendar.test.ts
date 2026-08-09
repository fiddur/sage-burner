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
import { account, accountRole, event } from '../db/schema.ts'

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

/** Straight into the table, so the route rather than `createEvent` is what is under test. */
const givenEvent = async (over: { feed_token?: string | null } = {}) => {
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
      feed_token: 'feed_token' in over ? over.feed_token : `token-${id}`,
      created_at: NOW,
    })
  return id
}

const givenAccount = async (roles: ('admin' | 'member')[] = ['member']) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return { id, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
}

const read = (server: FastifyInstance, eventId: string, cookie?: string) =>
  server.inject({
    method: 'GET',
    url: `/api/events/${eventId}/calendar`,
    headers: cookie === undefined ? {} : { cookie },
  })

const rotate = (server: FastifyInstance, eventId: string, cookie?: string) =>
  server.inject({
    method: 'POST',
    url: `/api/admin/events/${eventId}/calendar`,
    headers: cookie === undefined ? {} : { cookie },
  })

const tokenOf = async (eventId: string) =>
  (await db().select({ feed_token: event.feed_token }).from(event).where(eq(event.id, eventId)))[0]
    ?.feed_token

describe('where a burn’s calendar feed lives', () => {
  it('answers the token to a member, which is what the link is built from', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const wren = await givenAccount()

    const got = await read(server, eventId, wren.cookie)

    expect(got.statusCode).toBe(200)
    expect(got.json().token).toBe(`token-${eventId}`)
  })

  it('answers it to an organiser who is not attending', async () => {
    // `requireApproved`, like the schedule the feed is of.
    const server = await build()
    const eventId = await givenEvent()
    const boss = await givenAccount(['admin'])

    expect((await read(server, eventId, boss.cookie)).statusCode).toBe(200)
  })

  it('is nobody’s to read who is not approved', async () => {
    // The whole point: a token anybody could ask for would be a public id again (#408).
    const server = await build()
    const eventId = await givenEvent()
    const nobody = await givenAccount([])

    expect((await read(server, eventId)).statusCode).toBe(401)
    expect((await read(server, eventId, nobody.cookie)).statusCode).toBe(403)
  })

  it('gives a burn written without one an address on first read', async () => {
    // The column is nullable only because adding it needed no rebuild, so a null is a gap
    // to close rather than a state to report.
    const server = await build()
    const eventId = await givenEvent({ feed_token: null })
    const wren = await givenAccount()

    const got = await read(server, eventId, wren.cookie)

    expect(got.statusCode).toBe(200)
    expect(got.json().token).not.toBe('')
    expect(await tokenOf(eventId)).toBe(got.json().token)
  })

  it('mints one for a burn made through the app, without answering it', async () => {
    // `eventSchema` is what the *public* homepage is answered with, so the token must not
    // ride along in the create response.
    const server = await build()
    const boss = await givenAccount(['admin'])

    const made = await server.inject({
      method: 'POST',
      url: '/api/admin/events',
      headers: { cookie: boss.cookie },
      payload: {
        name: 'Autumn burn',
        slug: 'autumn-burn',
        start_date: '2026-10-02',
        end_date: '2026-10-04',
        member_cap: 42,
      },
    })

    expect(made.statusCode).toBe(201)
    expect(made.payload).not.toContain('feed_token')
    expect(await tokenOf(made.json().event.id)).not.toBeNull()
  })

  it('answers 404 for a burn that is not there', async () => {
    const server = await build()
    const wren = await givenAccount()

    expect((await read(server, randomUUID(), wren.cookie)).statusCode).toBe(404)
  })
})

describe('giving the feed a new address', () => {
  it('changes it, so the old link stops working', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const boss = await givenAccount(['admin'])

    const rotated = await rotate(server, eventId, boss.cookie)

    expect(rotated.statusCode).toBe(200)
    expect(rotated.json().token).not.toBe(`token-${eventId}`)
    expect(await tokenOf(eventId)).toBe(rotated.json().token)
    expect(
      (await server.inject({ method: 'GET', url: `/calendar/token-${eventId}/schedule.ics` })).statusCode,
    ).toBe(404)
    // The passing sibling: the new one works, so rotation is not just a way to break it.
    expect(
      (
        await server.inject({
          method: 'GET',
          url: `/calendar/${rotated.json().token}/schedule.ics`,
        })
      ).statusCode,
    ).toBe(200)
  })

  it('is admin’s alone, through the prefix hook', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const wren = await givenAccount(['member'])

    expect((await rotate(server, eventId)).statusCode).toBe(401)
    expect((await rotate(server, eventId, wren.cookie)).statusCode).toBe(403)
    // And nothing moved: a refused rotation must not have half-happened.
    expect(await tokenOf(eventId)).toBe(`token-${eventId}`)
  })

  it('answers 404 for a burn that is not there', async () => {
    const server = await build()
    const boss = await givenAccount(['admin'])

    expect((await rotate(server, randomUUID(), boss.cookie)).statusCode).toBe(404)
  })
})
