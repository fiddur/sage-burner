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
import { account, accountRole, activity, attendance, event } from '../db/schema.ts'
import { FEED_LIMIT } from './feed.ts'

/**
 * What everyone has been doing (#303).
 *
 * The point of the page is that these lines are there whether or not anybody switched
 * the matching notification on — so no test here turns one on, and the burn-wide writes
 * still fill the feed.
 */

const SECRET = 'v'.repeat(40)
const NOW = '2026-07-02T00:00:00.000Z'
const BURN = 'e0000000-0000-4000-8000-000000000001'
const OTHER_BURN = 'e0000000-0000-4000-8000-000000000002'

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

const client = () => {
  const found = handle?.client
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

const givenBurn = async (id = BURN, name = 'Summer burn', slug = 'summer') => {
  await db().insert(event).values({
    id,
    name,
    slug,
    start_date: '2026-08-01',
    end_date: '2026-08-03',
    member_cap: 20,
    created_at: NOW,
  })
}

const givenComing = async (accountId: string, eventId = BURN) => {
  await db()
    .insert(attendance)
    .values({ id: randomUUID(), event_id: eventId, account_id: accountId, joined_at: NOW })
}

const feed = (server: FastifyInstance, cookie?: string) =>
  server.inject({ method: 'GET', url: '/api/feed', ...(cookie === undefined ? {} : { headers: { cookie } }) })

const lines = async (server: FastifyInstance, cookie: string): Promise<string[]> =>
  (await feed(server, cookie)).json().activity.map((one: { body: string }) => one.body)

/** A line written straight into the table, for the cases a frozen clock cannot stage. */
const givenLine = async (body: string, created_at: string, eventId = BURN, id = randomUUID()) => {
  await db()
    .insert(activity)
    .values({ id, event_id: eventId, category: 'dream_offered', body, link: null, created_at })
}

const offerDream = (server: FastifyInstance, cookie: string, title: string, eventId = BURN) =>
  server.inject({
    method: 'POST',
    url: `/api/events/${eventId}/sessions`,
    headers: { cookie },
    payload: { title },
  })

describe('the feed', () => {
  it('carries a line for a dream nobody asked to hear about', async () => {
    // The whole reason the page exists: `dream_offered` is off by default, so today the
    // ordinary way to learn somebody offered one was to go looking at the schedule.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)

    expect((await offerDream(server, ada.cookie, 'Sauna at dawn')).statusCode).toBe(201)

    expect(await lines(server, ada.cookie)).toEqual(['Ada offered a dream: Sauna at dawn'])
  })

  it('shows it to the person who did it, unlike the notification', async () => {
    // Never notifying somebody about their own click is #247's rule about the bell. The
    // feed is a page somebody chose to open, so leaving their own line out would make
    // it read as though nothing happened.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)

    await offerDream(server, ada.cookie, 'Sauna at dawn')

    const response = await feed(server, ada.cookie)
    expect(response.json().activity).toHaveLength(1)
  })

  it('names the burn, and spans them', async () => {
    // Between burns the app is quiet, which is what the page is for — so a line from the
    // burn somebody is not in still shows, with its name on it.
    const server = await build()
    await givenBurn()
    await givenBurn(OTHER_BURN, 'Autumn burn', 'autumn')
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    await givenComing(bea.id, OTHER_BURN)

    await offerDream(server, ada.cookie, 'Sauna at dawn')
    await offerDream(server, bea.cookie, 'Cacao ceremony', OTHER_BURN)

    const rows = (await feed(server, ada.cookie)).json().activity
    expect(rows.map((one: { burn: string }) => one.burn).sort()).toEqual(['Autumn burn', 'Summer burn'])
  })

  it('carries the category, so the chip can offer to switch it on', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)

    await offerDream(server, ada.cookie, 'Sauna at dawn')

    const [row] = (await feed(server, ada.cookie)).json().activity
    expect(row.category).toBe('dream_offered')
    expect(row.link).toBe('/dreams')
  })

  it('has a line for somebody saying they are coming, and for a lead role', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const bea = await givenAccount('Bea')

    await server.inject({
      method: 'POST',
      url: `/api/events/${BURN}/attendance/me`,
      headers: { cookie: bea.cookie },
    })
    await server.inject({
      method: 'POST',
      url: `/api/events/${BURN}/roles`,
      headers: { cookie: ada.cookie },
      payload: { title: 'Firewood' },
    })

    // Sorted, not in feed order: the suite's clock is frozen, so both lines share a
    // stamp and which comes first is the tie-break's business rather than this test's.
    expect((await lines(server, ada.cookie)).toSorted()).toEqual([
      'A new lead role: Firewood',
      'Bea is coming.',
    ])
  })

  it('is newest first', async () => {
    // Written straight in, with two stamps: the app's clock is frozen in this suite, so
    // two writes through the routes would share a millisecond and the order would come
    // down to the tie-break below rather than to the time.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    await givenLine('Earlier', '2026-07-01T10:00:00.000Z')
    await givenLine('Later', '2026-07-01T11:00:00.000Z')

    expect(await lines(server, ada.cookie)).toEqual(['Later', 'Earlier'])
  })

  it('breaks a shared stamp by id, so two reads cannot disagree', async () => {
    // A copied register writes several rows a millisecond apart, and nothing promises
    // that — an order that changed between two reads of the same rows would read as
    // though something had happened again. Asserted as the expected order rather than as
    // two equal reads: SQLite answers one query the same way twice with or without the
    // tie-break, so comparing two runs proves nothing.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    // Written in the opposite order to their ids, which is what makes this reject the
    // tie-break's removal: without it SQLite answers in rowid order, which here is the
    // order they were written rather than the order the ids ask for.
    await givenLine('One', NOW, BURN, 'a0000000-0000-4000-8000-000000000003')
    await givenLine('Two', NOW, BURN, 'a0000000-0000-4000-8000-000000000002')
    await givenLine('Three', NOW, BURN, 'a0000000-0000-4000-8000-000000000001')

    expect(await lines(server, ada.cookie)).toEqual(['One', 'Two', 'Three'])
  })

  it('stops at the limit rather than answering the whole table', async () => {
    // A page, not an audit log. The other half of the retention rule, and the reason
    // `FEED_LIMIT` is a named export rather than a literal in the query.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    for (let index = 0; index <= FEED_LIMIT; index += 1) {
      await givenLine(`Line ${index}`, `2026-07-01T10:${String(index).padStart(2, '0')}:00.000Z`)
    }

    const rows = (await feed(server, ada.cookie)).json().activity
    expect(rows).toHaveLength(FEED_LIMIT)
    // And it is the newest that survive the cut, not the first written.
    expect(rows[0].body).toBe(`Line ${FEED_LIMIT}`)
  })

  it('refuses anybody without a role, and anybody not signed in', async () => {
    const server = await build()
    const nobody = await givenAccount('Nemo', [])

    expect((await feed(server)).statusCode).toBe(401)
    expect((await feed(server, nobody.cookie)).statusCode).toBe(403)
  })

  it('lets an admin who is coming to nothing read it', async () => {
    // The roles are independent, and somebody organising but not attending is who most
    // wants to know whether anything is happening.
    const server = await build()
    await givenBurn()
    const organiser = await givenAccount('Cai', ['admin'])

    expect((await feed(server, organiser.cookie)).statusCode).toBe(200)
  })

  it('goes with the burn, which is the whole retention rule', async () => {
    // Asserted against the table, not the route: the route's `innerJoin event` hides an
    // orphan either way, so reading through it would pass with the cascade removed.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    await offerDream(server, ada.cookie, 'Sauna at dawn')
    expect(await db().select().from(activity)).toHaveLength(1)

    await db().delete(event).where(eq(event.id, BURN))

    expect(await db().select().from(activity)).toEqual([])
    expect(await lines(server, ada.cookie)).toEqual([])
  })

  it('refuses a category the vocabulary has never heard of', async () => {
    // The CHECK, proved by a write that skips the API — the migration's, not the
    // schema's, since the test database is built from the SQL.
    await build()
    await givenBurn()

    expect(() =>
      client()
        .prepare('insert into activity (id, event_id, category, body, created_at) values (?, ?, ?, ?, ?)')
        .run(randomUUID(), BURN, 'gossip', 'something happened', NOW),
    ).toThrow()
  })

  it('holds nothing but what a burn-wide notification says', async () => {
    // The disclosure argument, as an assertion: every column the route selects comes
    // from `activity` or the burn's name, so a payment date or an address cannot reach
    // the page through it.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    await offerDream(server, ada.cookie, 'Sauna at dawn')

    const [row] = (await feed(server, ada.cookie)).json().activity
    expect(Object.keys(row).sort()).toEqual([
      'body',
      'burn',
      'category',
      'created_at',
      'event_id',
      'id',
      'link',
    ])
  })

  it('writes nothing when it is read', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    await offerDream(server, ada.cookie, 'Sauna at dawn')

    await feed(server, ada.cookie)
    await feed(server, ada.cookie)

    expect(await db().select().from(activity)).toHaveLength(1)
    // And no bell row for the reader: the two surfaces are separate, and reading one
    // must not fill the other.
    const bell = await server.inject({
      method: 'GET',
      url: '/api/me/notifications',
      headers: { cookie: ada.cookie },
    })
    expect(bell.json().notifications).toEqual([])
  })
})
