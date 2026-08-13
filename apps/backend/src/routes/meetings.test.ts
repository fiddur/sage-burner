import type { FastifyInstance } from 'fastify'

import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, activity, attendance, event, thread, threadEntry } from '../db/schema.ts'

const SECRET = 'm'.repeat(40)
const NOW = '2026-07-02T00:00:00.000Z'
const BURN = 'e0000000-0000-4000-8000-000000000001'
const OVER = 'e0000000-0000-4000-8000-000000000002'

let handle: DbHandle | undefined
let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  handle?.close()
  app = undefined
  handle = undefined
})

const db = () => {
  const found = handle?.db
  if (found === undefined) throw new Error('build() first')

  return found
}

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

const givenAccount = async (name: string, roles: ('admin' | 'member')[] = ['member']) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, name, password_hash: null, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })

  return { id, name, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
}

const givenBurn = async (
  id = BURN,
  { start_date = '2026-08-01', end_date = '2026-08-03', slug = 'summer' } = {},
) => {
  await db()
    .insert(event)
    .values({ id, name: 'Summer burn', slug, start_date, end_date, member_cap: 20, created_at: NOW })
}

const givenComing = async (accountId: string, eventId = BURN) => {
  await db()
    .insert(attendance)
    .values({ id: randomUUID(), event_id: eventId, account_id: accountId, joined_at: NOW })
}

const raise = (server: FastifyInstance, cookie: string, payload: Record<string, unknown>, eventId = BURN) =>
  server.inject({ method: 'POST', url: `/api/events/${eventId}/points`, headers: { cookie }, payload })

const points = (server: FastifyInstance, cookie: string, eventId = BURN) =>
  server.inject({ method: 'GET', url: `/api/events/${eventId}/points`, headers: { cookie } })

const decide = (server: FastifyInstance, cookie: string, id: string, payload: Record<string, unknown>) =>
  server.inject({ method: 'PUT', url: `/api/points/${id}/decision`, headers: { cookie }, payload })

const schedule = (
  server: FastifyInstance,
  cookie: string,
  payload: Record<string, unknown>,
  eventId = BURN,
) => server.inject({ method: 'POST', url: `/api/events/${eventId}/meetings`, headers: { cookie }, payload })

const listing = async (
  server: FastifyInstance,
  cookie: string,
): Promise<{ id: string; thread_id: string | null }[]> => (await points(server, cookie)).json().points

interface Card {
  entity_type: string
  entity_id: string
  title: string
  entries: { kind: string; body: string }[]
}

const cardFor = async (server: FastifyInstance, cookie: string, meetingId: string): Promise<Card> => {
  const feed = await server.inject({ method: 'GET', url: '/api/feed', headers: { cookie } })
  const mine = (feed.json().threads as Card[]).find((card) => card.entity_id === meetingId)
  if (mine === undefined) throw new Error('no card for that meeting')

  return mine
}

const meetings = (server: FastifyInstance, cookie: string, eventId = BURN) =>
  server.inject({ method: 'GET', url: `/api/events/${eventId}/meetings`, headers: { cookie } })

describe('talking points', () => {
  it('takes one from any approved member, the agenda being shared furniture', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')

    const raised = await raise(server, ada.cookie, { title: 'Where do we park?' })

    expect(raised.statusCode).toBe(201)
    expect(raised.json().point).toMatchObject({
      title: 'Where do we park?',
      decision: null,
      author_name: 'Ada',
    })
  })

  it('turns somebody with no role away', async () => {
    const server = await build()
    await givenBurn()
    const nobody = await givenAccount('Nobody', [])

    expect((await raise(server, nobody.cookie, { title: 'Where do we park?' })).statusCode).toBe(403)
  })

  it('gives it a thread, so the discussion is the point itself', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')

    const raised = await raise(server, ada.cookie, { title: 'Where do we park?' })

    expect(raised.json().point.thread_id).not.toBeNull()
  })

  it('refuses one on a burn that is over', async () => {
    const server = await build()
    await givenBurn(OVER, { start_date: '2025-08-01', end_date: '2025-08-03', slug: 'last-year' })
    const ada = await givenAccount('Ada')

    expect((await raise(server, ada.cookie, { title: 'Too late' }, OVER)).statusCode).toBe(404)
  })

  it('lists what has been raised for the burn asked about, and nothing from another', async () => {
    const server = await build()
    await givenBurn()
    await givenBurn(OVER, { start_date: '2026-09-01', end_date: '2026-09-03', slug: 'autumn' })
    const ada = await givenAccount('Ada')
    await raise(server, ada.cookie, { title: 'Summer question' })
    await raise(server, ada.cookie, { title: 'Autumn question' }, OVER)

    expect(
      (await points(server, ada.cookie)).json().points.map((one: { title: string }) => one.title),
    ).toEqual(['Summer question'])
  })
})

describe('deciding a point', () => {
  const raised = async (server: FastifyInstance, cookie: string, title = 'Where do we park?') =>
    (await raise(server, cookie, { title })).json().point.id as string

  it('records the decision, which is what makes a point addressed', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const id = await raised(server, ada.cookie)

    const decided = await decide(server, ada.cookie, id, {
      decision: 'By the barn',
      decided_note: 'Planning call Oct 20',
    })

    expect(decided.statusCode).toBe(200)
    expect(decided.json().point).toMatchObject({
      decision: 'By the barn',
      decided_note: 'Planning call Oct 20',
    })
  })

  it('is any approved member, not only whoever raised it', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bo = await givenAccount('Bo')
    const id = await raised(server, ada.cookie)

    expect((await decide(server, bo.cookie, id, { decision: 'By the barn' })).statusCode).toBe(200)
  })

  it('reopens the point when the decision is cleared', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const id = await raised(server, ada.cookie)
    await decide(server, ada.cookie, id, { decision: 'By the barn' })

    const reopened = await decide(server, ada.cookie, id, { decision: null })

    expect(reopened.json().point).toMatchObject({ decision: null, decided_note: null })
  })

  it('writes the decision into the thread, so the feed card carries it too', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const id = await raised(server, ada.cookie)

    await decide(server, ada.cookie, id, { decision: 'By the barn' })

    const [point] = await listing(server, ada.cookie)
    const said = await server.inject({
      method: 'GET',
      url: `/api/threads/${point?.thread_id ?? ''}`,
      headers: { cookie: ada.cookie },
    })
    expect(
      said.json().thread.entries.map((entry: { kind: string; body: string }) => [entry.kind, entry.body]),
    ).toEqual([
      ['raised', 'raised this'],
      ['decided', 'By the barn'],
    ])
  })

  it('tells the burn about a decision, and never the person who recorded it', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bo = await givenAccount('Bo')
    await givenComing(ada.id)
    await givenComing(bo.id)
    const id = await raised(server, ada.cookie)
    await server.inject({
      method: 'PUT',
      url: '/api/me/notification-settings',
      headers: { cookie: bo.cookie },
      payload: { on: ['point_decided'], email: [] },
    })

    await decide(server, ada.cookie, id, { decision: 'By the barn' })

    const bells = await server.inject({
      method: 'GET',
      url: '/api/me/notifications',
      headers: { cookie: bo.cookie },
    })
    expect(bells.json().notifications.map((one: { body: string }) => one.body)).toEqual([
      'Ada recorded a decision on: Where do we park?',
    ])
  })

  it('refuses a decision on a burn that is over', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const id = await raised(server, ada.cookie)
    await db().update(event).set({ start_date: '2025-08-01', end_date: '2025-08-03' })

    expect((await decide(server, ada.cookie, id, { decision: 'Too late' })).statusCode).toBe(404)
  })
})

describe('who may change a point', () => {
  const raised = async (server: FastifyInstance, cookie: string, title = 'Where do we park?') =>
    (await raise(server, cookie, { title })).json().point.id as string

  it('is whoever raised it, the wording being theirs', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const id = await raised(server, ada.cookie)

    const changed = await server.inject({
      method: 'PATCH',
      url: `/api/points/${id}`,
      headers: { cookie: ada.cookie },
      payload: { title: 'Where does everybody park?' },
    })

    expect(changed.statusCode).toBe(200)
    expect(changed.json().point.title).toBe('Where does everybody park?')
  })

  it('is not somebody else, however approved they are', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bo = await givenAccount('Bo')
    const id = await raised(server, ada.cookie)

    const changed = await server.inject({
      method: 'PATCH',
      url: `/api/points/${id}`,
      headers: { cookie: bo.cookie },
      payload: { title: 'Something else entirely' },
    })

    expect(changed.statusCode).toBe(403)
  })

  it('lets an admin take one off, which whoever raised it can do as well', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const boss = await givenAccount('Boss', ['admin'])
    const id = await raised(server, ada.cookie)

    const gone = await server.inject({
      method: 'DELETE',
      url: `/api/points/${id}`,
      headers: { cookie: boss.cookie },
    })

    expect(gone.statusCode).toBe(204)
    expect((await points(server, ada.cookie)).json().points).toEqual([])
  })

  it('takes the card off the feed when a point goes, for the same reason', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const id = (await raise(server, ada.cookie, { title: 'Where do we park?' })).json().point.id

    await server.inject({ method: 'DELETE', url: `/api/points/${id}`, headers: { cookie: ada.cookie } })

    const feed = await server.inject({ method: 'GET', url: '/api/feed', headers: { cookie: ada.cookie } })
    expect(feed.json().threads).toEqual([])
  })

  it('refuses a member who neither raised it nor organises', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bo = await givenAccount('Bo')
    const id = await raised(server, ada.cookie)

    const gone = await server.inject({
      method: 'DELETE',
      url: `/api/points/${id}`,
      headers: { cookie: bo.cookie },
    })

    expect(gone.statusCode).toBe(403)
  })
})

describe('the meetings themselves', () => {
  it('goes in the diary, with the link people join on', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')

    const put = await schedule(server, ada.cookie, {
      title: 'Planning call',
      starts_at: '2026-07-20T17:00:00.000Z',
      link: 'https://meet.example/abc',
    })

    expect(put.statusCode).toBe(201)
    expect(put.json().meeting).toMatchObject({
      title: 'Planning call',
      starts_at: '2026-07-20T17:00:00.000Z',
      ends_at: null,
      link: 'https://meet.example/abc',
    })
  })

  it('gets a card, so the one thing on the feed nobody could reply to now takes replies', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)

    const put = await schedule(server, ada.cookie, {
      title: 'Planning call',
      starts_at: '2026-07-20T17:00:00.000Z',
    })

    const card = await cardFor(server, ada.cookie, put.json().meeting.id)

    expect(card).toMatchObject({ entity_type: 'meeting', title: 'Planning call' })
    expect(card.entries.map((entry) => [entry.kind, entry.body])).toEqual([
      ['scheduled', 'put it in the diary'],
    ])
  })

  it('writes no line beside that card, which would put one thing on the feed twice', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)

    await schedule(server, ada.cookie, { title: 'Planning call', starts_at: '2026-07-20T17:00:00.000Z' })

    expect(await db().select().from(activity)).toEqual([])
  })

  it('bumps the card when it moves, which is the half worth hearing', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const id = (
      await schedule(server, ada.cookie, { title: 'Planning call', starts_at: '2026-07-20T17:00:00.000Z' })
    ).json().meeting.id

    await server.inject({
      method: 'PATCH',
      url: `/api/meetings/${id}`,
      headers: { cookie: ada.cookie },
      payload: {
        title: 'Planning call',
        starts_at: '2026-07-21T18:00:00.000Z',
        ends_at: null,
        notes: '',
      },
    })

    // One entry, not two: the `scheduled` kind coalesces.
    const card = await cardFor(server, ada.cookie, id)
    expect(card.entries.map((entry) => entry.body)).toEqual(['moved it'])
  })

  it('says nothing more when the time is untouched, a reworded note not being news', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const id = (
      await schedule(server, ada.cookie, { title: 'Planning call', starts_at: '2026-07-20T17:00:00.000Z' })
    ).json().meeting.id

    await server.inject({
      method: 'PATCH',
      url: `/api/meetings/${id}`,
      headers: { cookie: ada.cookie },
      payload: {
        title: 'Planning call',
        starts_at: '2026-07-20T17:00:00.000Z',
        ends_at: null,
        notes: 'bring the map',
      },
    })

    expect((await cardFor(server, ada.cookie, id)).entries).toHaveLength(1)
  })

  it('refuses one that ends before it starts', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')

    const put = await schedule(server, ada.cookie, {
      title: 'Planning call',
      starts_at: '2026-07-20T17:00:00.000Z',
      ends_at: '2026-07-20T16:00:00.000Z',
    })

    expect(put.statusCode).toBe(400)
  })

  it('takes one that ends after it starts, which is the ordinary case', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')

    const put = await schedule(server, ada.cookie, {
      title: 'Planning call',
      starts_at: '2026-07-20T17:00:00.000Z',
      ends_at: '2026-07-20T18:30:00.000Z',
    })

    expect(put.statusCode).toBe(201)
  })

  it('answers them in the order they happen', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await schedule(server, ada.cookie, { title: 'Second', starts_at: '2026-07-21T17:00:00.000Z' })
    await schedule(server, ada.cookie, { title: 'First', starts_at: '2026-07-20T17:00:00.000Z' })

    expect(
      (await meetings(server, ada.cookie)).json().meetings.map((one: { title: string }) => one.title),
    ).toEqual(['First', 'Second'])
  })

  it('is nobody without a role', async () => {
    const server = await build()
    await givenBurn()
    const nobody = await givenAccount('Nobody', [])

    expect((await meetings(server, nobody.cookie)).statusCode).toBe(403)
  })

  it('changes one that is already in the diary', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const id = (
      await schedule(server, ada.cookie, { title: 'Planning call', starts_at: '2026-07-20T17:00:00.000Z' })
    ).json().meeting.id

    const changed = await server.inject({
      method: 'PATCH',
      url: `/api/meetings/${id}`,
      headers: { cookie: ada.cookie },
      payload: {
        title: 'Planning call, moved',
        starts_at: '2026-07-21T18:00:00.000Z',
        ends_at: null,
        link: 'https://meet.example/abc',
        notes: '',
      },
    })

    expect(changed.statusCode).toBe(200)
    expect(changed.json().meeting).toMatchObject({
      title: 'Planning call, moved',
      starts_at: '2026-07-21T18:00:00.000Z',
      link: 'https://meet.example/abc',
    })
  })

  it('refuses a change that would end it before it starts', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const id = (
      await schedule(server, ada.cookie, { title: 'Planning call', starts_at: '2026-07-20T17:00:00.000Z' })
    ).json().meeting.id

    const changed = await server.inject({
      method: 'PATCH',
      url: `/api/meetings/${id}`,
      headers: { cookie: ada.cookie },
      payload: {
        title: 'Planning call',
        starts_at: '2026-07-21T18:00:00.000Z',
        ends_at: '2026-07-21T17:00:00.000Z',
        notes: '',
      },
    })

    expect(changed.statusCode).toBe(400)
  })

  it('takes its card off the feed with it, the meeting no longer existing to have one', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const id = (
      await schedule(server, ada.cookie, { title: 'Planning call', starts_at: '2026-07-20T17:00:00.000Z' })
    ).json().meeting.id

    await server.inject({ method: 'DELETE', url: `/api/meetings/${id}`, headers: { cookie: ada.cookie } })

    const feed = await server.inject({ method: 'GET', url: '/api/feed', headers: { cookie: ada.cookie } })
    expect(feed.json().threads).toEqual([])
  })

  it('leaves nothing of the conversation about it either', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const id = (
      await schedule(server, ada.cookie, { title: 'Planning call', starts_at: '2026-07-20T17:00:00.000Z' })
    ).json().meeting.id

    await server.inject({ method: 'DELETE', url: `/api/meetings/${id}`, headers: { cookie: ada.cookie } })

    expect(await db().select().from(thread)).toEqual([])
    expect(await db().select().from(threadEntry)).toEqual([])
  })

  it('takes one off the diary again', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const id = (
      await schedule(server, ada.cookie, { title: 'Planning call', starts_at: '2026-07-20T17:00:00.000Z' })
    ).json().meeting.id

    const gone = await server.inject({
      method: 'DELETE',
      url: `/api/meetings/${id}`,
      headers: { cookie: ada.cookie },
    })

    expect(gone.statusCode).toBe(204)
    expect((await meetings(server, ada.cookie)).json().meetings).toEqual([])
  })
})
