import type { FeedKind, Thread } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { feedPath, mentionToken } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, migrationsFolder, runMigrations } from '../db/index.ts'
import {
  account,
  accountRole,
  attendance,
  event,
  leadRole,
  place,
  session,
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
 * **Everything on it is a card** (#610): one shape, carrying its whole history and the
 * talk under it, whether it is a dream, a person at a burn, an announcement or a lead role.
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

const feed = (server: FastifyInstance, cookie?: string, kinds: readonly FeedKind[] = []) =>
  server.inject({
    method: 'GET',
    url: feedPath(kinds),
    ...(cookie === undefined ? {} : { headers: { cookie } }),
  })

/** A card written straight in, for the cases a frozen clock cannot stage. */
const givenDreamCard = async (
  title: string,
  created_at: string,
  { eventId = BURN, id = randomUUID() }: { eventId?: string; id?: string } = {},
) => {
  const dream = randomUUID()

  await db().insert(session).values({ id: dream, event_id: eventId, title })
  await db().insert(thread).values({
    id,
    event_id: eventId,
    entity_type: 'session',
    entity_id: dream,
    subject_account_id: null,
    title,
  })
  await db().insert(threadEntry).values({
    id: randomUUID(),
    thread_id: id,
    kind: 'offered',
    seq: 1,
    author_account_id: null,
    body: 'offered this dream',
    created_at,
    edited_at: null,
  })
}

const titles = async (
  server: FastifyInstance,
  cookie: string,
  kinds: readonly FeedKind[] = [],
): Promise<string[]> => (await cards(server, cookie, kinds)).map((card) => card.title)

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

const cards = async (
  server: FastifyInstance,
  cookie: string,
  kinds: readonly FeedKind[] = [],
): Promise<Thread[]> => (await feed(server, cookie, kinds)).json().threads

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
    // And nothing beside it: one offer is one thing on the page, not two.
    expect(await cards(server, ada.cookie)).toHaveLength(1)
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
    // The bug this fixes. A line freezing the title into a sentence went on offering
    // "Sauna at dawn" after it had been renamed; a card carries the thread's own title
    // and the rename keeps it in step.
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

  it('takes a withdrawn dream off the page, a removal not being something going on', async () => {
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

    expect(await cards(server, ada.cookie)).toEqual([])
  })

  it('keeps the conversation the withdrawal ended, which the thread still answers', async () => {
    // The soft withdrawal is still soft: what people said to each other is what
    // `thread.entity_id` carries no key for. It is off the feed, not deleted.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const dream = await offerDream(server, ada.cookie, 'Sauna at dawn')
    const [before] = await cards(server, ada.cookie)

    await server.inject({
      method: 'DELETE',
      url: `/api/sessions/${dream}`,
      headers: { cookie: ada.cookie },
    })

    const answered = await server.inject({
      method: 'GET',
      url: `/api/threads/${before?.id ?? ''}`,
      headers: { cookie: ada.cookie },
    })
    expect(answered.json().thread.gone).toBe(true)
    expect(answered.json().thread.title).toBe('Sauna at dawn')
    expect(answered.json().thread.entries.map((entry: { kind: string }) => entry.kind)).toEqual([
      'offered',
      'withdrawn',
    ])
  })

  it('names the burn, and spans them', async () => {
    const server = await build()
    await givenBurn()
    await givenBurn(OTHER_BURN, 'Autumn burn', 'autumn')
    const ada = await givenAccount('Ada')
    await givenDreamCard('Something here', NOW)
    await givenDreamCard('Something there', NOW, { eventId: OTHER_BURN })

    const rows = await cards(server, ada.cookie)
    expect(rows.map((one) => one.burn).toSorted()).toEqual(['Autumn burn', 'Summer burn'])
  })

  it('gives a lead role a card of its own, linked to the register at its burn', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)

    await addLeadRole(server, ada.cookie, 'Firewood')

    const [card] = await cards(server, ada.cookie)
    expect(card?.entity_type).toBe('role')
    expect(card?.title).toBe('Firewood')
    expect(card?.link).toBe(`/roles?burn=${BURN}`)
    expect(card?.entries.map((entry) => [entry.author?.name, entry.kind, entry.body])).toEqual([
      ['Ada', 'added', 'added this lead role'],
    ])
  })

  it('has a card for a lead role, and one for somebody saying they are coming', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const bea = await givenAccount('Bea')

    await joinBurn(server, bea.cookie)
    await addLeadRole(server, ada.cookie, 'Firewood')

    expect(
      (await cards(server, ada.cookie)).map((card) => [card.entity_type, card.title]).toSorted(),
    ).toEqual(
      [
        ['attendance', 'Bea'],
        ['role', 'Firewood'],
      ].toSorted(),
    )
  })

  it('is newest first', async () => {
    // Written straight in, with two stamps: the app's clock is frozen in this suite, so
    // two writes through the routes would share a millisecond and the order would come
    // down to the tie-break below rather than to the time.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    await givenDreamCard('Earlier', '2026-07-01T10:00:00.000Z')
    await givenDreamCard('Later', '2026-07-01T11:00:00.000Z')

    expect(await titles(server, ada.cookie)).toEqual(['Later', 'Earlier'])
  })

  it('puts the higher id first where two cards share a stamp, so two reads cannot disagree', async () => {
    // A copied register writes several rows a millisecond apart, and nothing promises
    // that — an order that changed between two reads of the same rows would read as
    // though something had happened again. This pins the order `recentThreads` asks for;
    // it does not prove the tie-break, since SQLite answers this group-by the same way
    // with and without it, which was measured rather than reasoned out.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    await givenDreamCard('One', NOW, { id: 'a0000000-0000-4000-8000-000000000001' })
    await givenDreamCard('Two', NOW, { id: 'a0000000-0000-4000-8000-000000000002' })
    await givenDreamCard('Three', NOW, { id: 'a0000000-0000-4000-8000-000000000003' })

    expect(await titles(server, ada.cookie)).toEqual(['Three', 'Two', 'One'])
  })

  it('stops at the limit rather than answering the whole table', async () => {
    // A page, not an audit log. The other half of the retention rule, and the reason
    // `FEED_LIMIT` is a named export rather than a literal in the query.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    for (let index = 0; index <= FEED_LIMIT; index += 1) {
      await givenDreamCard(`Card ${index}`, `2026-07-01T10:${String(index).padStart(2, '0')}:00.000Z`)
    }

    const rows = await titles(server, ada.cookie)
    expect(rows).toHaveLength(FEED_LIMIT)
    // And it is the newest that survive the cut, not the first written.
    expect(rows[0]).toBe(`Card ${FEED_LIMIT}`)
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
    expect(await db().select().from(thread)).toHaveLength(2)

    await db().delete(event).where(eq(event.id, BURN))

    // The thread goes with the burn, and the entries with the thread — a conversation
    // outlives its dream, not the burn it was at.
    expect(await db().select().from(thread)).toEqual([])
    expect(await db().select().from(threadEntry)).toEqual([])
    expect(await cards(server, ada.cookie)).toEqual([])
  })

  it('holds nothing but what a card is made of', async () => {
    // The disclosure argument, as an assertion: `readThreads` names every column it
    // answers with, so a payment date or an address cannot reach the page through it.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    await addLeadRole(server, ada.cookie, 'Firewood')

    const [row] = (await feed(server, ada.cookie)).json().threads
    expect(Object.keys(row).toSorted()).toEqual([
      'body',
      'burn',
      'entity_id',
      'entity_type',
      'entries',
      'entry_count',
      'event_id',
      'followed_by_me',
      'gone',
      'id',
      'last_at',
      'link',
      'own',
      'support_count',
      'supported_by_me',
      'supporters',
      'title',
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

  it('calls clearing that place taking it off rather than saying where it would be', async () => {
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

    await editDream(server, ada.cookie, dream, { place_id: null })

    const [card] = await cards(server, ada.cookie)
    expect(card?.entries.at(-1)?.body).toBe('took the place off it')
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

  it('leaves the ones nobody took back where they were', async () => {
    // The passing sibling: what goes is the withdrawn one, not the page around it.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const older = await offerDream(server, ada.cookie, 'Sauna at dawn')
    stamp = '2026-07-02T01:00:00.000Z'
    await offerDream(server, ada.cookie, 'Cacao ceremony')
    stamp = '2026-07-02T02:00:00.000Z'
    await offerDream(server, ada.cookie, 'Cold plunge')

    stamp = '2026-07-02T03:00:00.000Z'
    await server.inject({
      method: 'DELETE',
      url: `/api/sessions/${older}`,
      headers: { cookie: ada.cookie },
    })

    expect((await cards(server, ada.cookie)).map((card) => card.title)).toEqual([
      'Cold plunge',
      'Cacao ceremony',
    ])
  })

  it('does not bring one back when somebody says something on it', async () => {
    // #611's fix left a taken-back card in place and let a comment lift it; the card is
    // off the page now, so there is nothing for the comment to lift.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const older = await offerDream(server, ada.cookie, 'Sauna at dawn')
    const [first] = await cards(server, ada.cookie)
    stamp = '2026-07-02T01:00:00.000Z'
    await offerDream(server, ada.cookie, 'Cacao ceremony')
    stamp = '2026-07-02T02:00:00.000Z'
    await server.inject({
      method: 'DELETE',
      url: `/api/sessions/${older}`,
      headers: { cookie: ada.cookie },
    })

    stamp = '2026-07-02T03:00:00.000Z'
    await say(server, ada.cookie, first?.id ?? '', 'shame, I was coming to that')

    expect((await cards(server, ada.cookie)).map((card) => card.title)).toEqual(['Cacao ceremony'])
  })

  it('takes an announcement off the page when it is taken back', async () => {
    // Four routes write a `withdrawn` entry — this is the one whose bin is on the feed
    // itself, so the card goes from under the press that removed it.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const announced = await server.inject({
      method: 'POST',
      url: `/api/events/${BURN}/posts`,
      headers: { cookie: ada.cookie },
      payload: { title: 'The gate opens at noon', body: '' },
    })
    expect(await cards(server, ada.cookie)).toHaveLength(1)

    await server.inject({
      method: 'DELETE',
      url: `/api/posts/${announced.json().post.id}`,
      headers: { cookie: ada.cookie },
    })

    expect(await cards(server, ada.cookie)).toEqual([])
  })

  it('cuts the page against everything on it, whatever kind each one is', async () => {
    // Fifty things, not fifty of each: a burn full of talk must not push the rest off
    // the page, and a quiet one must not leave it half empty.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    for (let index = 0; index < FEED_LIMIT; index += 1) {
      await givenDreamCard(`Card ${index}`, `2026-07-01T10:${String(index).padStart(2, '0')}:00.000Z`)
    }

    // Newer than every one of them, so it takes the last place and one card loses it.
    stamp = '2026-07-03T00:00:00.000Z'
    await addLeadRole(server, ada.cookie, 'Firewood')

    const shown = await titles(server, ada.cookie)
    expect(shown).toHaveLength(FEED_LIMIT)
    expect(shown[0]).toBe('Firewood')
    expect(shown).not.toContain('Card 0')
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

    expect(await db().select().from(threadEntry)).toHaveLength(2)
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

  it('carries the whole introduction, because that card is the person’s presentation', async () => {
    // It was cut at 280 characters with an ellipsis (#478). The excerpt rules exist to stop a
    // post or a dream swallowing the feed, not to truncate the one thing whose whole job is to
    // be read — and `MAX_INTRODUCTION` already bounds it.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await joinBurn(server, ada.cookie)
    const whole = `${'word '.repeat(200)}end`

    await introduce(server, ada.cookie, whole)

    expect((await cardOf(server, ada.cookie, 'Ada'))?.body).toBe(whole)
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

  it('leaves the page once they are no longer coming, and keeps what was said', async () => {
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

    expect(await cards(server, bea.cookie)).toEqual([])
    const answered = await server.inject({
      method: 'GET',
      url: `/api/threads/${before?.id ?? ''}`,
      headers: { cookie: bea.cookie },
    })
    // Still their name and still their page: the stay is what has gone, not the person, and
    // the card is found by the person now (#449).
    expect(answered.json().thread.gone).toBe(true)
    expect(answered.json().thread.link).toBe(`/members/${ada.id}`)
    expect(answered.json().thread.title).toBe('Ada')
    expect(answered.json().thread.entries.map((entry: { kind: string }) => entry.kind)).toEqual([
      'joined',
      'comment',
    ])
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

describe('a lead role added before roles had cards', () => {
  it('gets one from the backfill, dated from when the role appeared', async () => {
    // The other half of `20260815100100_role_cards` (#610): what it writes is what the feed
    // reads. Staged by hand and swept by the shipped SQL, since the migration has long run by
    // the time this suite can add a role.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const older = randomUUID()
    await db().insert(leadRole).values({
      id: older,
      event_id: BURN,
      title: 'Firewood',
      purpose: '',
      tasks: '',
      effort_before: 'none',
      effort_during: 'none',
      effort_after: 'none',
      team_size_wanted: 0,
      lead_attendance_id: null,
      created_at: '2026-07-01T09:00:00.000Z',
    })
    expect(await cards(server, ada.cookie)).toEqual([])

    client().exec(
      readFileSync(path.join(migrationsFolder, '20260815100100_role_cards', 'migration.sql'), 'utf8'),
    )

    const [card] = await cards(server, ada.cookie)
    expect(card?.title).toBe('Firewood')
    expect(card?.entries.map((entry) => [entry.author, entry.kind, entry.body])).toEqual([
      [null, 'added', 'added this lead role'],
    ])
    // Dated by the adding rather than by the deploy, so an old role does not arrive at the
    // top of the feed as though it were news.
    expect(card?.last_at).toBe('2026-07-01T09:00:00.000Z')
  })

  it('leaves the card a role already has alone, rather than beginning it twice', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const role = (await addLeadRole(server, ada.cookie, 'Firewood')).json().role.id

    client().exec(
      readFileSync(path.join(migrationsFolder, '20260815100100_role_cards', 'migration.sql'), 'utf8'),
    )

    const mine = (await cards(server, ada.cookie)).filter((card) => card.entity_id === role)
    expect(mine).toHaveLength(1)
    expect(mine[0]?.entries.map((entry) => entry.body)).toEqual(['added this lead role'])
  })
})

describe('the kinds a viewer asks for', () => {
  const staged = async (server: FastifyInstance, cookie: string) => {
    await offerDream(server, cookie, 'Sauna at dawn')
    await joinBurn(server, cookie)
    await addLeadRole(server, cookie, 'Fire lead')
  }

  it('answers with everything when it is asked for nothing', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada', ['admin', 'member'])

    await staged(server, ada.cookie)

    expect((await cards(server, ada.cookie)).map((card) => card.entity_type).toSorted()).toEqual([
      'attendance',
      'role',
      'session',
    ])
  })

  it('answers with one kind and nothing else when one kind is asked for', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada', ['admin', 'member'])

    await staged(server, ada.cookie)

    expect((await cards(server, ada.cookie, ['session'])).map((card) => card.entity_type)).toEqual([
      'session',
    ])
  })

  it('answers with the lead roles and nothing else when only those are asked for', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada', ['admin', 'member'])

    await staged(server, ada.cookie)

    expect((await cards(server, ada.cookie, ['role'])).map((card) => card.title)).toEqual(['Fire lead'])
  })

  it('answers with two kinds at once, which is what taking one chip off leaves', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada', ['admin', 'member'])

    await staged(server, ada.cookie)

    expect(
      (await cards(server, ada.cookie, ['session', 'attendance'])).map((card) => card.entity_type).toSorted(),
    ).toEqual(['attendance', 'session'])
  })

  it('loses a person’s card behind a run of dreams when nothing is filtered', async () => {
    // The premise the filter exists for, and it has to hold for the next test to say anything.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await joinBurn(server, ada.cookie)
    for (let index = 0; index < FEED_LIMIT; index += 1) {
      await givenDreamCard(`Dream ${index}`, `2026-07-03T10:${String(index).padStart(2, '0')}:00.000Z`)
    }

    expect((await cards(server, ada.cookie)).map((card) => card.entity_type)).not.toContain('attendance')
  })

  it('finds that card when only people are asked for, because the cut comes after the filter', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await joinBurn(server, ada.cookie)
    for (let index = 0; index < FEED_LIMIT; index += 1) {
      await givenDreamCard(`Dream ${index}`, `2026-07-03T10:${String(index).padStart(2, '0')}:00.000Z`)
    }

    expect((await cards(server, ada.cookie, ['attendance'])).map((card) => card.title)).toEqual(['Ada'])
  })

  it('ignores a kind it does not know, rather than failing the read', async () => {
    // A stale link shows more than asked for and never an error page — `feedKindsFrom`'s rule,
    // asserted through the route because that is where a rejected query would show.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await offerDream(server, ada.cookie, 'Sauna at dawn')

    const answered = await server.inject({
      method: 'GET',
      url: '/api/feed?kinds=dremas',
      headers: { cookie: ada.cookie },
    })

    expect(answered.statusCode).toBe(200)
    expect(answered.json().threads).toHaveLength(1)
  })
})
