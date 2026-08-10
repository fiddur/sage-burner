import type { Thread } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { INTRODUCTION_EXCERPT, mentionToken } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import {
  account,
  accountRole,
  activity,
  attendance,
  event,
  place,
  thread,
  threadEntry,
} from '../db/schema.ts'
import { sendGuarded } from '../if-match.testing.ts'
import { CARD_ENTRIES, FEED_LIMIT } from './feed.ts'

/**
 * What everyone has been doing (#303), and what they are talking about (#375).
 *
 * The point of the page is that these are there whether or not anybody switched the
 * matching notification on — so no test here turns one on, and the burn-wide writes
 * still fill the feed.
 *
 * **A lead role is what stages a line**, since anything with a thread is a card instead:
 * offering a dream, and — since #426 — saying you are coming. The two halves are asserted
 * separately, which is what the response's two arrays are.
 */

const SECRET = 'v'.repeat(40)
const NOW = '2026-07-02T00:00:00.000Z'
const BURN = 'e0000000-0000-4000-8000-000000000001'
const OTHER_BURN = 'e0000000-0000-4000-8000-000000000002'

let handle: DbHandle | undefined
let app: FastifyInstance | undefined
/** The app's clock, so the few tests about order can move it between writes. */
let stamp = NOW

afterEach(async () => {
  await app?.close()
  handle?.close()
  app = undefined
  handle = undefined
  stamp = NOW
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
    now: () => new Date(stamp),
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

const offerDream = async (server: FastifyInstance, cookie: string, title: string, eventId = BURN) => {
  const response = await server.inject({
    method: 'POST',
    url: `/api/events/${eventId}/sessions`,
    headers: { cookie },
    payload: { title },
  })

  return response.json().session.id as string
}

const joinBurn = (server: FastifyInstance, cookie: string, eventId = BURN) =>
  server.inject({ method: 'POST', url: `/api/events/${eventId}/attendance/me`, headers: { cookie } })

const addLeadRole = (server: FastifyInstance, cookie: string, title: string, eventId = BURN) =>
  server.inject({
    method: 'POST',
    url: `/api/events/${eventId}/roles`,
    headers: { cookie },
    payload: { title },
  })

const cards = async (server: FastifyInstance, cookie: string): Promise<Thread[]> =>
  (await feed(server, cookie)).json().threads

const say = (server: FastifyInstance, cookie: string, threadId: string, body: string) =>
  server.inject({
    method: 'POST',
    url: `/api/threads/${threadId}/comments`,
    headers: { cookie },
    payload: { body },
  })

const editDream = (
  server: FastifyInstance,
  cookie: string,
  dream: string,
  payload: Record<string, unknown>,
) =>
  sendGuarded((headers) =>
    server.inject({
      method: 'PATCH',
      url: `/api/sessions/${dream}`,
      headers: { cookie, ...headers },
      payload,
    }),
  )

const moveTo = (server: FastifyInstance, cookie: string, dream: string, hour: string) =>
  editDream(server, cookie, dream, {
    time_slot_start: `2026-08-01T${hour}:00:00.000Z`,
    time_slot_end: `2026-08-01T${hour}:30:00.000Z`,
  })

describe('the feed', () => {
  it('carries a card for a dream nobody asked to hear about', async () => {
    // The whole reason the page exists: `dream_offered` is off by default, so before it
    // the ordinary way to learn somebody offered one was to go looking at the schedule.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)

    await offerDream(server, ada.cookie, 'Sauna at dawn')

    const [card] = await cards(server, ada.cookie)
    expect(card?.title).toBe('Sauna at dawn')
    expect(card?.entries.map((entry) => [entry.author?.name, entry.kind, entry.body])).toEqual([
      ['Ada', 'offered', 'offered this dream'],
    ])
    // And no line beside it: one offer is one thing on the page, not two.
    expect(await lines(server, ada.cookie)).toEqual([])
  })

  it('shows it to the person who did it, unlike the notification', async () => {
    // Never notifying somebody about their own click is #247's rule about the bell. The
    // feed is a page somebody chose to open, so leaving their own card out would make
    // it read as though nothing happened.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)

    await offerDream(server, ada.cookie, 'Sauna at dawn')

    expect(await cards(server, ada.cookie)).toHaveLength(1)
  })

  it('heads a card with what the dream is called now, not what it was called then', async () => {
    // The bug this fixes. An `activity` line freezes the title into a sentence, so the
    // feed went on offering "Sauna at dawn" after it had been renamed; a card carries the
    // thread's own title and the rename keeps it in step.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const dream = await offerDream(server, ada.cookie, 'Sauna at dawn')

    await editDream(server, ada.cookie, dream, { title: 'Sauna at dusk' })

    const [card] = await cards(server, ada.cookie)
    expect(card?.title).toBe('Sauna at dusk')
    expect(card?.entries.map((entry) => entry.body)).toEqual([
      'offered this dream',
      'renamed it to “Sauna at dusk”',
    ])
  })

  it('keeps the conversation when the dream is withdrawn, and says so', async () => {
    // Withdrawing states it on the card rather than deleting it: what people said to
    // each other stays worth reading, which is why `thread.entity_id` carries no key.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const dream = await offerDream(server, ada.cookie, 'Sauna at dawn')

    await server.inject({
      method: 'DELETE',
      url: `/api/sessions/${dream}`,
      headers: { cookie: ada.cookie },
    })

    const [card] = await cards(server, ada.cookie)
    expect(card?.gone).toBe(true)
    expect(card?.title).toBe('Sauna at dawn')
    expect(card?.entries.map((entry) => entry.kind)).toEqual(['offered', 'withdrawn'])
  })

  it('names the burn, and spans them', async () => {
    const server = await build()
    await givenBurn()
    await givenBurn(OTHER_BURN, 'Autumn burn', 'autumn')
    const ada = await givenAccount('Ada')
    await givenLine('Something here', NOW)
    await givenLine('Something there', NOW, OTHER_BURN)

    const rows = (await feed(server, ada.cookie)).json().activity
    expect(rows.map((one: { burn: string }) => one.burn).toSorted()).toEqual(['Autumn burn', 'Summer burn'])
  })

  it('carries the category, so the chip can offer to switch it on', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)

    await addLeadRole(server, ada.cookie, 'Firewood')

    const [row] = (await feed(server, ada.cookie)).json().activity
    expect(row.category).toBe('lead_role_added')
    expect(row.link).toBe('/roles')
  })

  it('has a line for a lead role, and a card for somebody saying they are coming', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const bea = await givenAccount('Bea')

    await joinBurn(server, bea.cookie)
    await addLeadRole(server, ada.cookie, 'Firewood')

    expect(await lines(server, ada.cookie)).toEqual(['A new lead role: Firewood'])
    const [card] = await cards(server, ada.cookie)
    expect(card?.title).toBe('Bea')
    expect(card?.entries.map((entry) => [entry.kind, entry.body])).toEqual([['joined', 'is coming']])
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
    // tie-break's removal. What answers without it is a reverse scan of
    // `activity_recent_idx`, where equal `created_at` keys come back rowid-descending —
    // so the two orders differ only when the ids run against the writing order. Measured
    // by removing `desc(activity.id)` and watching this fail, not reasoned out.
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
    await addLeadRole(server, ada.cookie, 'Firewood')
    await offerDream(server, ada.cookie, 'Sauna at dawn')
    expect(await db().select().from(activity)).toHaveLength(1)
    expect(await db().select().from(thread)).toHaveLength(1)

    await db().delete(event).where(eq(event.id, BURN))

    expect(await db().select().from(activity)).toEqual([])
    // The thread goes with it too, and the entries with the thread — a conversation
    // outlives its dream, not the burn it was at.
    expect(await db().select().from(thread)).toEqual([])
    expect(await db().select().from(threadEntry)).toEqual([])
    expect(await lines(server, ada.cookie)).toEqual([])
    expect(await cards(server, ada.cookie)).toEqual([])
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
    await addLeadRole(server, ada.cookie, 'Firewood')

    const [row] = (await feed(server, ada.cookie)).json().activity
    expect(Object.keys(row).toSorted()).toEqual([
      'body',
      'burn',
      'category',
      'created_at',
      'event_id',
      'id',
      'link',
    ])
  })

  it('folds an afternoon of dragging into one line', async () => {
    // Coalescing on the write: same kind, same person, nothing in between. Without it a
    // grid session writes a line per drag and the thread is unreadable — and the card
    // would show four moves and none of the talk.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const dream = await offerDream(server, ada.cookie, 'Sauna at dawn')

    await moveTo(server, ada.cookie, dream, '09')
    await moveTo(server, ada.cookie, dream, '10')
    await moveTo(server, ada.cookie, dream, '11')

    const [card] = await cards(server, ada.cookie)
    expect(card?.entries.map((entry) => entry.kind)).toEqual(['offered', 'scheduled'])
    expect(card?.entry_count).toBe(2)
  })

  it('calls a place with no time a place rather than a move in the schedule', async () => {
    // A dream that is in no time slot is not in the schedule, so it cannot have moved in one
    // (#387). Giving it a lane says where it will be.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const dream = await offerDream(server, ada.cookie, 'Sauna at dawn')
    const lane = randomUUID()
    await db()
      .insert(place)
      .values({ id: lane, event_id: BURN, order: 0, name: 'The sauna', emoji: '🔥', color: 'red' })

    await editDream(server, ada.cookie, dream, { place_id: lane })

    const [card] = await cards(server, ada.cookie)
    expect(card?.entries.at(-1)?.body).toBe('said where it would be')
  })

  it('keeps a rename and a move apart', async () => {
    // Why these are three kinds rather than one `edited`: coalescing is per aspect, so a
    // later move must not overwrite the rename that came before it.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const dream = await offerDream(server, ada.cookie, 'Sauna at dawn')

    await editDream(server, ada.cookie, dream, { title: 'Sauna at dusk' })
    await moveTo(server, ada.cookie, dream, '09')

    const [card] = await cards(server, ada.cookie)
    expect(card?.entries.map((entry) => entry.kind)).toEqual(['offered', 'renamed', 'scheduled'])
  })

  it('shows the end of the conversation, and says how much more there is', async () => {
    // What bounds the page, and with it what the installed app keeps on disk: a card
    // carries a few lines whatever the thread holds.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    await offerDream(server, ada.cookie, 'Sauna at dawn')
    const [opened] = await cards(server, ada.cookie)
    if (opened === undefined) throw new Error('no card')

    for (const word of ['one', 'two', 'three', 'four']) await say(server, ada.cookie, opened.id, word)

    const [card] = await cards(server, ada.cookie)
    expect(card?.entries).toHaveLength(CARD_ENTRIES)
    expect(card?.entries.map((entry) => entry.body)).toEqual(['two', 'three', 'four'])
    expect(card?.entry_count).toBe(5)
  })

  it('rises when somebody says something', async () => {
    // What the page is for: a dream offered a week ago that is being talked about this
    // morning belongs at the top, and the sort key is the newest entry rather than the
    // thread's own age.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)

    await offerDream(server, ada.cookie, 'Sauna at dawn')
    stamp = '2026-07-02T01:00:00.000Z'
    await offerDream(server, ada.cookie, 'Cacao ceremony')

    expect((await cards(server, ada.cookie)).map((card) => card.title)).toEqual([
      'Cacao ceremony',
      'Sauna at dawn',
    ])

    const older = (await cards(server, ada.cookie)).find((card) => card.title === 'Sauna at dawn')
    if (older === undefined) throw new Error('no card')
    stamp = '2026-07-02T02:00:00.000Z'
    await say(server, ada.cookie, older.id, 'is this before or after dinner?')

    expect((await cards(server, ada.cookie)).map((card) => card.title)).toEqual([
      'Sauna at dawn',
      'Cacao ceremony',
    ])
  })

  it('cuts the page against both halves, not each on its own', async () => {
    // Fifty things, not fifty of each: a burn full of talk must not push the news off
    // the page, and a quiet one must not leave it half empty.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    for (let index = 0; index < FEED_LIMIT; index += 1) {
      await givenLine(`Line ${index}`, `2026-07-01T10:${String(index).padStart(2, '0')}:00.000Z`)
    }

    // Newer than every one of them, so it takes the last place and one line loses it.
    stamp = '2026-07-03T00:00:00.000Z'
    await offerDream(server, ada.cookie, 'Sauna at dawn')

    const response = (await feed(server, ada.cookie)).json()
    expect(response.threads).toHaveLength(1)
    expect(response.activity).toHaveLength(FEED_LIMIT - 1)
  })

  it('writes nothing when it is read', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    await addLeadRole(server, ada.cookie, 'Firewood')
    await offerDream(server, ada.cookie, 'Sauna at dawn')

    await feed(server, ada.cookie)
    await feed(server, ada.cookie)

    expect(await db().select().from(activity)).toHaveLength(1)
    expect(await db().select().from(threadEntry)).toHaveLength(1)
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

describe('somebody’s own card', () => {
  const introduce = (server: FastifyInstance, cookie: string, introduction: string) =>
    server.inject({ method: 'PATCH', url: '/api/me/profile', headers: { cookie }, payload: { introduction } })

  const cardOf = async (server: FastifyInstance, cookie: string, title: string) =>
    (await cards(server, cookie)).find((one) => one.title === title)

  it('is titled by the name now, not the one frozen when they joined', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await joinBurn(server, ada.cookie)

    await db().update(account).set({ name: 'Ada B' }).where(eq(account.id, ada.id))

    expect((await cards(server, ada.cookie))[0]?.title).toBe('Ada B')
  })

  it('links to the person rather than to a dream', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await joinBurn(server, ada.cookie)

    expect((await cards(server, ada.cookie))[0]?.link).toBe(`/members/${ada.id}`)
  })

  it('links a dream card at the dream, with the burn it belongs to', async () => {
    // The other half: building the link moved from the web to `readThreads`, and the test moved
    // with it for the person's card only (#449).
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const dream = await offerDream(server, ada.cookie, 'Sauna at dawn')

    const card = await cardOf(server, ada.cookie, 'Sauna at dawn')
    expect(card?.link).toBe(`/dreams?burn=${BURN}&dream=${dream}`)
  })

  it('carries the introduction itself, so the feed says who somebody is', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await joinBurn(server, ada.cookie)

    await introduce(server, ada.cookie, 'I build saunas.')

    const card = await cardOf(server, ada.cookie, 'Ada')
    expect(card?.body).toBe('I build saunas.')
    expect(card?.entries.map((entry) => entry.kind)).toEqual(['joined', 'introduced'])
  })

  it('refreshes a name written into an introduction, as it does in a comment', async () => {
    // `readThreads` collected mention ids from entry bodies and post bodies only, so a token in
    // an introduction kept whatever name was typed (#457). Nothing offers mentions there yet,
    // which is what made it latent rather than broken.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await joinBurn(server, ada.cookie)
    await givenComing(bea.id)

    await introduce(server, ada.cookie, `I build saunas with ${mentionToken('Beatrice', bea.id)}.`)

    const card = await cardOf(server, ada.cookie, 'Ada')
    expect(card?.body).toContain(mentionToken('Bea', bea.id))
  })

  it('clamps a long introduction rather than putting the whole of it in the feed', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await joinBurn(server, ada.cookie)

    await introduce(server, ada.cookie, `${'word '.repeat(200)}end`)

    const card = await cardOf(server, ada.cookie, 'Ada')
    expect(card?.body?.length).toBeLessThanOrEqual(INTRODUCTION_EXCERPT + 1)
    expect(card?.body?.endsWith('…')).toBe(true)
  })

  it('carries no body for a dream, whose content is its title and its entries', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)

    await offerDream(server, ada.cookie, 'Sauna at dawn')

    expect((await cards(server, ada.cookie))[0]?.body).toBeNull()
  })

  it('is not gone while somebody is still coming', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await joinBurn(server, ada.cookie)

    expect((await cards(server, ada.cookie))[0]?.gone).toBe(false)
  })

  it('says somebody is no longer coming once they have left, and keeps what was said', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(bea.id)
    await joinBurn(server, ada.cookie)
    const [before] = await cards(server, bea.cookie)
    await say(server, bea.cookie, before?.id ?? '', 'welcome')

    await server.inject({
      method: 'DELETE',
      url: `/api/events/${BURN}/attendance/me`,
      headers: { cookie: ada.cookie },
    })

    const [card] = await cards(server, bea.cookie)
    expect(card?.gone).toBe(true)
    // Still their name and still their page: the stay is what has gone, not the person, and
    // the card is found by the person now (#449).
    expect(card?.link).toBe(`/members/${ada.id}`)
    expect(card?.title).toBe('Ada')
    expect(card?.entries.map((entry) => entry.kind)).toEqual(['joined', 'comment'])
  })

  it('reopens the one card on a rejoin rather than stranding it and opening another', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(bea.id)
    await joinBurn(server, ada.cookie)
    const [opened] = await cards(server, bea.cookie)
    await say(server, bea.cookie, opened?.id ?? '', 'welcome')

    await server.inject({
      method: 'DELETE',
      url: `/api/events/${BURN}/attendance/me`,
      headers: { cookie: ada.cookie },
    })
    await joinBurn(server, ada.cookie)

    const mine = (await cards(server, bea.cookie)).filter((card) => card.title === 'Ada')
    expect(mine).toHaveLength(1)
    expect(mine[0]?.gone).toBe(false)
    expect(mine[0]?.entries.map((entry) => entry.kind)).toEqual(['joined', 'comment', 'joined'])
  })
})
