import type { FastifyInstance } from 'fastify'

import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { isCheckViolation } from '../db/errors.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, event } from '../db/schema.ts'
import { sendGuarded } from '../if-match.testing.ts'

const SECRET = 's'.repeat(40)

let handle: DbHandle | undefined
let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  handle?.close()
  app = undefined
  handle = undefined
})

let clock = new Date('2026-06-01T12:00:00.000Z')

const build = async (today = '2026-06-01') => {
  clock = new Date(`${today}T12:00:00.000Z`)
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: SECRET }),
    now: () => clock,
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
    .values({
      id,
      email: `${id}@example.org`,
      password_hash: null,
      created_at: '2026-01-01T00:00:00.000Z',
    })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  const sessions = createSessions({ secret: SECRET, now: () => clock, ttlSeconds: 3600 })
  return `${SESSION_COOKIE}=${sessions.issue(id)}`
}

const givenAdmin = () => givenAccount(['admin'])

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
      payment_info_markdown: '',
      member_cap: 42,
      feed_token: `token-${id}`,
      created_at: '2026-01-01T00:00:00.000Z',
    })
  return id
}

const active = (server: FastifyInstance) => server.inject({ method: 'GET', url: '/api/events/active' })

const create = (server: FastifyInstance, cookie: string, payload: Record<string, unknown>) =>
  server.inject({ method: 'POST', url: '/api/admin/events', headers: { cookie }, payload })

const patch = (server: FastifyInstance, cookie: string, id: string, payload: Record<string, unknown>) =>
  server.inject({ method: 'PATCH', url: `/api/admin/events/${id}`, headers: { cookie }, payload })

const setWelcome = (
  server: FastifyInstance,
  cookie: string | undefined,
  id: string,
  payload: Record<string, unknown>,
) =>
  sendGuarded((extra) =>
    server.inject({
      method: 'PATCH',
      url: `/api/events/${id}/welcome`,
      headers: { ...(cookie === undefined ? {} : { cookie }), ...extra },
      payload,
    }),
  )

const valid = {
  name: 'Summer Burn 2026',
  slug: 'summer-2026',
  start_date: '2026-08-01',
  end_date: '2026-08-05',
  member_cap: 42,
}

describe('PATCH /api/events/:id/welcome', () => {
  it('lets any approved member rewrite the welcome text, admin or not', async () => {
    const server = await build()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    for (const roles of [['member'], ['admin'], ['member', 'admin']] as const) {
      const cookie = await givenAccount([...roles])
      const response = await setWelcome(server, cookie, id, { welcome_markdown: `By ${roles.join('+')}` })

      expect(response.statusCode, roles.join('+')).toBe(200)
      expect(response.json().event.welcome_markdown).toBe(`By ${roles.join('+')}`)
    }
  })

  it('refuses rewriting a burn that has ended, however approved the member', async () => {
    const server = await build('2026-09-01')
    const over = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })
    const cookie = await givenAccount(['member', 'admin'])

    const response = await setWelcome(server, cookie, over, { welcome_markdown: 'rewritten' })

    expect(response.statusCode).toBe(404)
    const [row] = await db().select().from(event).where(eq(event.id, over))
    expect(row?.welcome_markdown).toBe('')
  })

  it('still rewrites one that has not ended, including while it is running', async () => {
    const server = await build('2026-08-03')
    const running = await givenEvent({
      slug: 'summer-2026',
      start_date: '2026-08-01',
      end_date: '2026-08-05',
    })
    const cookie = await givenAccount(['member'])

    const response = await setWelcome(server, cookie, running, { welcome_markdown: 'still ours' })

    expect(response.statusCode).toBe(200)
    expect(response.json().event.welcome_markdown).toBe('still ours')
  })

  it('refuses a stranger and an account with no roles', async () => {
    const server = await build()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })
    const roleless = await givenAccount([])

    expect((await setWelcome(server, undefined, id, { welcome_markdown: 'x' })).statusCode).toBe(401)
    expect((await setWelcome(server, roleless, id, { welcome_markdown: 'x' })).statusCode).toBe(403)

    const [row] = await db().select().from(event).where(eq(event.id, id))
    expect(row?.welcome_markdown).toBe('')
  })

  it("refuses the burn's shape smuggled in beside the welcome text", async () => {
    const server = await build()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })
    const member = await givenAccount(['member'])

    const response = await setWelcome(server, member, id, { welcome_markdown: 'Hello', member_cap: 500 })

    expect(response.statusCode).toBe(400)
    const [row] = await db().select().from(event).where(eq(event.id, id))
    expect(row?.member_cap).toBe(42)
    expect(row?.welcome_markdown).toBe('')
  })

  it('still refuses a member at the admin route that writes the shape', async () => {
    const server = await build()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })
    const member = await givenAccount(['member'])

    expect((await patch(server, member, id, { member_cap: 500 })).statusCode).toBe(403)
    expect((await patch(server, member, id, { welcome_markdown: 'Hello' })).statusCode).toBe(403)
  })

  it('answers 404 for a burn that does not exist', async () => {
    const server = await build()
    const member = await givenAccount(['member'])

    expect((await setWelcome(server, member, randomUUID(), { welcome_markdown: 'x' })).statusCode).toBe(404)
  })

  it('requires the field rather than treating an empty body as a no-op', async () => {
    const server = await build()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })
    const member = await givenAccount(['member'])

    expect((await setWelcome(server, member, id, {})).statusCode).toBe(400)
  })
})

describe('GET /api/events/active', () => {
  it('carries no calendar feed token, which is the whole of what #408 fixed', async () => {
    const server = await build()
    await givenEvent({ slug: 'summer', start_date: '2026-08-01', end_date: '2026-08-05' })

    const response = await active(server)

    expect(response.payload).not.toContain('feed_token')
    expect(response.payload).not.toContain('token-')
    expect(response.json().event.slug).toBe('summer')
  })

  it('answers only what `Event` describes, so a new column cannot ride along', async () => {
    const server = await build()
    await givenEvent({ slug: 'summer', start_date: '2026-08-01', end_date: '2026-08-05' })

    const keys = Object.keys((await active(server)).json().event).toSorted()

    expect(keys).toEqual([
      'created_at',
      'end_date',
      'end_time',
      'id',
      'location',
      'member_cap',
      'name',
      'payment_info_markdown',
      'slug',
      'start_date',
      'start_time',
      'transfer_info_markdown',
      'welcome_markdown',
    ])
  })

  it('is null before any event exists', async () => {
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
    const server = await build('2026-08-06')
    await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    expect((await active(server)).json()).toEqual({ event: null })
  })

  it('breaks a tie deterministically', async () => {
    const server = await build('2026-06-01')
    await givenEvent({ slug: 'b-burn', start_date: '2026-08-02', end_date: '2026-08-05' })
    await givenEvent({ slug: 'a-burn', start_date: '2026-08-01', end_date: '2026-08-05' })

    expect((await active(server)).json().event.slug).toBe('a-burn')
  })

  it('is marked no-cache so an edit is not served stale', async () => {
    const server = await build()

    expect((await active(server)).headers['cache-control']).toBe('no-cache')
  })
})

describe('admin event routes', () => {
  it('refuse an anonymous caller', async () => {
    const server = await build()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    expect((await server.inject({ method: 'GET', url: '/api/admin/events' })).statusCode).toBe(401)
    expect(
      (await server.inject({ method: 'POST', url: '/api/admin/events', payload: valid })).statusCode,
    ).toBe(401)
    expect(
      (
        await server.inject({
          method: 'PATCH',
          url: `/api/admin/events/${id}`,
          payload: { welcome_markdown: 'x' },
        })
      ).statusCode,
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

  it('takes where the burn is held, and hands it back', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    const created = await create(server, cookie, { ...valid, location: 'Sagegården, Rättvik' })
    expect(created.json().event.location).toBe('Sagegården, Rättvik')

    const moved = await patch(server, cookie, created.json().event.id, { location: 'Ånn, Jämtland' })
    expect(moved.statusCode).toBe(200)
    expect(moved.json().event.location).toBe('Ånn, Jämtland')
  })

  it('leaves the place empty when the create does not name one', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    expect((await create(server, cookie, valid)).json().event.location).toBe('')
  })

  it('default the welcome text to empty so an event can exist before it is written', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    const response = await create(server, cookie, valid)

    expect(response.json().event.welcome_markdown).toBe('')
  })

  it('reject a duplicate slug with 409 rather than 500', async () => {
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

  it('treats an empty patch as a no-op rather than a 500', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    const response = await patch(server, cookie, id, {})

    expect(response.statusCode).toBe(200)
    expect(response.json().event).toMatchObject({ slug: 'summer-2026', welcome_markdown: '' })
  })

  it('rejects an unrecognised key on create too, not only on update', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    const response = await create(server, cookie, { ...valid, welcome: 'typo' })

    expect(response.statusCode).toBe(400)
    expect(await db().select().from(event)).toHaveLength(0)
  })

  it('answers 404 for an empty patch against an event that does not exist', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    const response = await patch(server, cookie, randomUUID(), {})

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })

  it('rejects a whole event object patched back, the round-trip docs/burns.md warns about', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })
    const [whole] = await db().select().from(event)
    if (whole === undefined) throw new Error('fixture missing')

    const response = await patch(server, cookie, id, { ...whole, name: 'Renamed' })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'bad_request' })
    const [row] = await db().select().from(event)
    expect(row).toMatchObject({ name: 'summer-2026' })
  })

  it('rejects an unrecognised key instead of answering "saved"', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    const response = await patch(server, cookie, id, { welcome: 'typo' })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'bad_request' })
  })

  it('rejects a patch with both dates in the wrong order', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    const response = await patch(server, cookie, id, { start_date: '2026-09-01', end_date: '2026-08-20' })

    expect(response.statusCode).toBe(400)
    const [row] = await db().select().from(event)
    expect(row).toMatchObject({ start_date: '2026-08-01', end_date: '2026-08-05' })
  })

  it('rejects a one-sided date move in either direction, and stores nothing', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    const movedStart = await patch(server, cookie, id, { start_date: '2026-09-01' })
    const movedEnd = await patch(server, cookie, id, { end_date: '2026-07-01' })

    expect(movedStart.statusCode).toBe(400)
    expect(movedStart.json()).toEqual({ error: 'bad_request' })
    expect(movedEnd.statusCode).toBe(400)
    const [row] = await db().select().from(event)
    expect(row).toMatchObject({ start_date: '2026-08-01', end_date: '2026-08-05' })
  })

  it('answers 200 when the welcome text is re-saved unchanged', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })
    await patch(server, cookie, id, { welcome_markdown: '# Bring water' })

    const response = await patch(server, cookie, id, { welcome_markdown: '# Bring water' })

    expect(response.statusCode).toBe(200)
    expect(response.json().event).toMatchObject({ welcome_markdown: '# Bring water' })
  })

  it('allows a one-sided date move that keeps the order, in either direction', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    const movedEnd = await patch(server, cookie, id, { end_date: '2026-08-09' })
    const movedStart = await patch(server, cookie, id, { start_date: '2026-08-03' })

    expect(movedEnd.statusCode).toBe(200)
    expect(movedStart.statusCode).toBe(200)
    const [row] = await db().select().from(event)
    expect(row).toMatchObject({ start_date: '2026-08-03', end_date: '2026-08-09' })
  })

  it('allows moving the whole range forward, with both dates in one patch', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    const response = await patch(server, cookie, id, { start_date: '2026-09-01', end_date: '2026-09-05' })

    expect(response.statusCode).toBe(200)
    expect(response.json().event).toMatchObject({ start_date: '2026-09-01', end_date: '2026-09-05' })
    const [row] = await db().select().from(event)
    expect(row).toMatchObject({ start_date: '2026-09-01', end_date: '2026-09-05' })
  })

  it('allows a start date landing exactly on the end date', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    const response = await patch(server, cookie, id, { start_date: '2026-08-05' })

    expect(response.statusCode).toBe(200)
    const [row] = await db().select().from(event)
    expect(row).toMatchObject({ start_date: '2026-08-05', end_date: '2026-08-05' })
  })

  it('allows an end date landing exactly on the start date', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    const response = await patch(server, cookie, id, { end_date: '2026-08-01' })

    expect(response.statusCode).toBe(200)
    const [row] = await db().select().from(event)
    expect(row).toMatchObject({ start_date: '2026-08-01', end_date: '2026-08-01' })
  })

  it('answers 404, not 400, when a valid one-sided move hits a deleted event', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })
    await db().delete(event).where(eq(event.id, id))

    const response = await patch(server, cookie, id, { start_date: '2026-08-02' })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })
  it("answers 409 when a patch takes another event's slug", async () => {
    const server = await build()
    const cookie = await givenAdmin()
    await givenEvent({ slug: 'winter-2026', start_date: '2026-12-01', end_date: '2026-12-05' })
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    const response = await patch(server, cookie, id, { slug: 'winter-2026' })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'conflict' })
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

describe('the hours a burn is open', () => {
  const client = () => {
    const found = handle?.client
    if (found === undefined) throw new Error('build() first')
    return found
  }

  it('defaults to the whole of both days, so a create form need not ask', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    const response = await create(server, cookie, valid)

    expect(response.statusCode).toBe(201)
    expect(response.json().event).toMatchObject({ start_time: '00:00', end_time: '23:59' })
  })

  it('takes the hours an admin gives it', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    const response = await create(server, cookie, {
      ...valid,
      start_time: '15:00',
      end_time: '12:00',
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().event).toMatchObject({ start_time: '15:00', end_time: '12:00' })
  })

  it('refuses a one-day burn that ends earlier in the day than it starts', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    const response = await create(server, cookie, {
      ...valid,
      start_date: '2026-08-01',
      end_date: '2026-08-01',
      start_time: '22:00',
      end_time: '10:00',
    })

    expect(response.statusCode).toBe(400)
  })

  it('accepts a one-day burn that runs forwards', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    const response = await create(server, cookie, {
      ...valid,
      start_date: '2026-08-01',
      end_date: '2026-08-01',
      start_time: '10:00',
      end_time: '22:00',
    })

    expect(response.statusCode).toBe(201)
  })

  it('refuses a time that is not a clock time', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    for (const bad of ['9:00', '24:00', '10:60', '1000']) {
      expect((await create(server, cookie, { ...valid, start_time: bad })).statusCode, bad).toBe(400)
    }
  })

  it('keeps a nonsense time out of the database, whatever the caller is', async () => {
    await build()
    const row = (start: string, end: string) => () =>
      client()
        .prepare(
          'insert into event (id, name, slug, start_date, end_date, start_time, end_time, member_cap, created_at) values (?,?,?,?,?,?,?,?,?)',
        )
        .run(
          randomUUID(),
          'x',
          `s-${randomUUID().slice(0, 8)}`,
          '2026-08-01',
          '2026-08-05',
          start,
          end,
          42,
          '2026-01-01T00:00:00.000Z',
        )

    expect(row('9:00', '12:00')).toThrow()
    expect(row('24:00', '12:00')).toThrow()
    expect(row('10:00', '12:00')).not.toThrow()
  })

  it('answers 400, not 500, when a patch would invert the stored hours', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const id = (await create(server, cookie, { ...valid, start_time: '22:00', end_time: '10:00' })).json()
      .event.id

    const response = await patch(server, cookie, id, {
      start_date: '2026-08-01',
      end_date: '2026-08-01',
    })

    expect(response.statusCode).toBe(400)
  })

  it('answers 400, not 500, when a patch inverts the times on a single-day burn', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const id = (
      await create(server, cookie, {
        ...valid,
        start_date: '2026-08-01',
        end_date: '2026-08-01',
        start_time: '10:00',
        end_time: '22:00',
      })
    ).json().event.id

    expect((await patch(server, cookie, id, { start_time: '23:00' })).statusCode).toBe(400)
  })

  it('answers 404 for a patch against an event that is not there', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    expect((await patch(server, cookie, randomUUID(), { name: 'Ghost' })).statusCode).toBe(404)
  })

  it('recognises the ordering CHECK by its message, so the race answers 400', async () => {
    await build()
    let raised: unknown

    try {
      client()
        .prepare(
          'insert into event (id, name, slug, start_date, end_date, start_time, end_time, member_cap, created_at) values (?,?,?,?,?,?,?,?,?)',
        )
        .run(
          randomUUID(),
          'x',
          'backwards-probe',
          '2026-08-01',
          '2026-08-01',
          '22:00',
          '10:00',
          42,
          '2026-01-01T00:00:00.000Z',
        )
    } catch (failure) {
      raised = failure
    }

    expect(isCheckViolation(raised, 'event_date_order_check')).toBe(true)
    expect(isCheckViolation(raised, 'event_member_cap_check')).toBe(false)
    expect(isCheckViolation(new Error('something else'), 'event_date_order_check')).toBe(false)
  })

  it('keeps an inverted single-day pair out too', async () => {
    await build()

    expect(() =>
      client()
        .prepare(
          'insert into event (id, name, slug, start_date, end_date, start_time, end_time, member_cap, created_at) values (?,?,?,?,?,?,?,?,?)',
        )
        .run(
          randomUUID(),
          'x',
          'backwards',
          '2026-08-01',
          '2026-08-01',
          '22:00',
          '10:00',
          42,
          '2026-01-01T00:00:00.000Z',
        ),
    ).toThrow()
  })
})

describe('rewriting a welcome somebody else has just rewritten', () => {
  const write = (server: FastifyInstance, cookie: string, id: string, text: string, version?: string) =>
    server.inject({
      method: 'PATCH',
      url: `/api/events/${id}/welcome`,
      headers: { cookie, ...(version === undefined ? {} : { 'if-match': version }) },
      payload: { welcome_markdown: text },
    })

  it('refuses one written against no version of the burn, and against an old one', async () => {
    const server = await build()
    const id = await givenEvent({ slug: 'summer', start_date: '2026-08-01', end_date: '2026-08-05' })
    const cookie = await givenAccount(['member'])
    const other = await givenAccount(['member'])

    const asTheySawIt = String((await active(server)).headers.etag)

    expect((await write(server, cookie, id, 'mine')).statusCode).toBe(428)

    expect((await setWelcome(server, other, id, { welcome_markdown: 'theirs' })).statusCode).toBe(200)

    const refused = await write(server, cookie, id, 'mine', asTheySawIt)
    expect(refused.statusCode).toBe(412)
    expect(refused.json().event.welcome_markdown).toBe('theirs')
  })

  it('takes one written against the version it was handed', async () => {
    const server = await build()
    const id = await givenEvent({ slug: 'summer', start_date: '2026-08-01', end_date: '2026-08-05' })
    const cookie = await givenAccount(['member'])

    const current = String((await active(server)).headers.etag)

    expect((await write(server, cookie, id, 'mine', current)).statusCode).toBe(200)
  })
})
