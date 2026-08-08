import type { FastifyInstance } from 'fastify'

import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DbHandle } from '../db/index.ts'
import type { Delivery } from '../push/push.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, attendance, event, place, pushSubscription, session } from '../db/schema.ts'
import { sendGuarded } from '../if-match.testing.ts'

const SECRET = 's'.repeat(40)
const NOW = '2026-07-02T00:00:00.000Z'
const SLOT = { time_slot_start: '2026-08-02T18:00:00.000Z', time_slot_end: '2026-08-02T20:00:00.000Z' }

let handle: DbHandle | undefined
let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  handle?.close()
  app = undefined
  handle = undefined
})

const build = async (deliver: Delivery = () => Promise.resolve('sent')) => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: SECRET }),
    now: () => new Date(NOW),
    deliver,
    mintKeys: () => ({ publicKey: 'a-public-key', privateKey: 'a-private-key' }),
  })
  return app
}

/** One browser opted in, so there is somewhere for a notification to go. */
const givenSubscribed = async (accountId: string) => {
  await db()
    .insert(pushSubscription)
    .values({
      id: randomUUID(),
      endpoint: `https://push.example.org/${randomUUID()}`,
      account_id: accountId,
      p256dh: 'a-key',
      auth: 'a-secret',
      created_at: NOW,
    })
}

/** What was pushed, as the strings a person would read. */
const messagesFrom = (deliver: ReturnType<typeof vi.fn<Delivery>>) =>
  deliver.mock.calls.map((call) => {
    const parsed: unknown = JSON.parse(String(call[1]))
    return typeof parsed === 'object' && parsed !== null && 'body' in parsed ? String(parsed.body) : ''
  })

const db = () => {
  const found = handle?.db
  if (found === undefined) throw new Error('build() first')
  return found
}

const givenAccount = async (roles: ('admin' | 'member')[]) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return { id, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
}

/**
 * A fixed id, so the helpers below can name the burn without every test threading
 * one through. The routes take an event id since #184's selector — "the active
 * burn" is a rule the client no longer applies.
 */
const OPEN_BURN = '9f1c2f2a-6f1a-4a2e-9c6d-2f0a1b3c4d5e'

const givenEvent = async (over: { id?: string; start_date?: string; end_date?: string } = {}) => {
  const id = over.id ?? OPEN_BURN
  await db()
    .insert(event)
    .values({
      id,
      name: 'Summer burn',
      slug: `burn-${id.slice(0, 8)}`,
      start_date: over.start_date ?? '2026-08-01',
      end_date: over.end_date ?? '2026-08-05',
      member_cap: 42,
      created_at: NOW,
    })
  return id
}

const givenPlace = async (eventId: string, name = 'Temple') => {
  const id = randomUUID()
  await db().insert(place).values({ id, event_id: eventId, order: 0, name, emoji: '🛕', color: 'yellow' })
  return id
}

const list = (server: FastifyInstance, cookie: string | undefined, eventId = OPEN_BURN) =>
  server.inject({
    method: 'GET',
    url: `/api/events/${eventId}/sessions`,
    headers: cookie === undefined ? {} : { cookie },
  })

const offer = (
  server: FastifyInstance,
  cookie: string | undefined,
  payload: Record<string, unknown>,
  eventId = OPEN_BURN,
) =>
  server.inject({
    method: 'POST',
    url: `/api/events/${eventId}/sessions`,
    headers: cookie === undefined ? {} : { cookie },
    payload,
  })

const editDream = (
  server: FastifyInstance,
  cookie: string | undefined,
  id: string,
  payload: Record<string, unknown>,
) =>
  sendGuarded((extra) =>
    server.inject({
      method: 'PATCH',
      url: `/api/sessions/${id}`,
      headers: { ...(cookie === undefined ? {} : { cookie }), ...extra },
      payload,
    }),
  )

const drop = (server: FastifyInstance, cookie: string | undefined, id: string) =>
  server.inject({
    method: 'DELETE',
    url: `/api/sessions/${id}`,
    headers: cookie === undefined ? {} : { cookie },
  })

const givenAttending = async (eventId: string, roles: ('admin' | 'member')[] = ['member']) => {
  const who = await givenAccount(roles)
  await db().insert(attendance).values({
    id: randomUUID(),
    event_id: eventId,
    account_id: who.id,
    joined_at: NOW,
    payment_status: 'unpaid',
  })

  return who
}

/** `POST` or `DELETE` on `/api/sessions/:id/support/me`. A heart is always your own. */
const selfService = (
  server: FastifyInstance,
  cookie: string | undefined,
  id: string,
  what: 'support',
  method: 'POST' | 'DELETE',
) =>
  server.inject({
    method,
    url: `/api/sessions/${id}/${what}/me`,
    headers: cookie === undefined ? {} : { cookie },
  })

/**
 * Offering hands, or taking them back. `about` names somebody other than the
 * caller — which is the whole of what changed in #247.
 */
const helping = (
  server: FastifyInstance,
  who: { cookie: string; id: string } | undefined,
  id: string,
  method: 'POST' | 'DELETE',
  about?: string,
) => {
  const accountId = about ?? who?.id ?? ''

  return server.inject({
    method,
    url: method === 'POST' ? `/api/sessions/${id}/helpers` : `/api/sessions/${id}/helpers/${accountId}`,
    headers: who === undefined ? {} : { cookie: who.cookie },
    ...(method === 'POST' ? { payload: { account_id: accountId } } : {}),
  })
}

describe('dreams', () => {
  it('is empty before anyone offers one', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])

    const response = await list(server, member.cookie)

    expect(response.statusCode).toBe(200)
    expect(response.json().sessions).toEqual([])
  })

  it('is empty rather than 404 when no burn is open', async () => {
    // The ordinary state of a fresh deployment, not an error.
    const server = await build()
    const member = await givenAccount(['member'])

    const response = await list(server, member.cookie)

    expect(response.statusCode).toBe(200)
    expect(response.json().sessions).toEqual([])
  })

  it('offers one with no time and no place, which is the normal state', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])

    const response = await offer(server, member.cookie, { title: 'Sunrise yoga' })

    expect(response.statusCode).toBe(201)
    expect(response.json().session).toMatchObject({
      title: 'Sunrise yoga',
      description: '',
      time_slot_start: null,
      time_slot_end: null,
      place_id: null,
      facilitator_account_id: null,
    })
  })

  it('takes a facilitator who is coming, and refuses one who is not', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenAccount(['member'])
    const elsewhere = await givenAccount(['member'])
    await db().insert(attendance).values({
      id: randomUUID(),
      event_id: eventId,
      account_id: member.id,
      joined_at: NOW,
      payment_status: 'unpaid',
    })

    const taken = await offer(server, member.cookie, {
      title: 'Sunrise yoga',
      facilitator_account_id: member.id,
    })
    expect(taken.statusCode).toBe(201)
    expect(taken.json().session.facilitator_account_id).toBe(member.id)

    // A 400 rather than a 404: the account exists, the pairing is what is wrong.
    const absent = await offer(server, member.cookie, {
      title: 'Cacao ceremony',
      facilitator_account_id: elsewhere.id,
    })
    expect(absent.statusCode).toBe(400)
  })

  it('hands a dream to somebody else, which the old rule refused outright', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenAccount(['member'])
    const other = await givenAccount(['member'])
    for (const who of [member.id, other.id]) {
      await db().insert(attendance).values({
        id: randomUUID(),
        event_id: eventId,
        account_id: who,
        joined_at: NOW,
        payment_status: 'unpaid',
      })
    }
    const id = (await offer(server, member.cookie, { title: 'Sunrise yoga' })).json().session.id

    const response = await editDream(server, member.cookie, id, { facilitator_account_id: other.id })

    expect(response.statusCode).toBe(200)
    expect(response.json().session.facilitator_account_id).toBe(other.id)
  })

  it('offers a dream as a one-off unless it is asked to repeat', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])

    const once = await offer(server, member.cookie, { title: 'Sunrise yoga' })
    const again = await offer(server, member.cookie, { title: 'Check in', repeatable: true })

    expect(once.json().session.repeatable).toBe(false)
    expect(again.json().session.repeatable).toBe(true)
  })

  it('turns the flag on and off again, since it is a decision people change', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])
    const id = (await offer(server, member.cookie, { title: 'Check in' })).json().session.id

    expect((await editDream(server, member.cookie, id, { repeatable: true })).json().session.repeatable).toBe(
      true,
    )
    expect(
      (await editDream(server, member.cookie, id, { repeatable: false })).json().session.repeatable,
    ).toBe(false)
  })

  it('refuses to attach it to a burn the caller did not name', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])

    expect((await offer(server, member.cookie, { title: 'x', event_id: randomUUID() })).statusCode).toBe(400)
  })

  it('answers 404 when there is no burn to offer it to', async () => {
    const server = await build()
    const member = await givenAccount(['member'])

    expect((await offer(server, member.cookie, { title: 'Sunrise yoga' })).statusCode).toBe(404)
  })

  it('schedules one into a place and a slot', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenAccount(['member'])
    const temple = await givenPlace(eventId)
    const id = (await offer(server, member.cookie, { title: 'Sunrise yoga' })).json().session.id

    const response = await editDream(server, member.cookie, id, { ...SLOT, place_id: temple })

    expect(response.statusCode).toBe(200)
    expect(response.json().session).toMatchObject({ ...SLOT, place_id: temple })
  })

  it('refuses a lane belonging to another burn', async () => {
    // Since #156 a place belongs to one burn, and the foreign key cannot say which:
    // it only knows the row exists. Without the check a dream could stand in a lane
    // this burn's grid does not draw, so it would vanish from the page while still
    // holding a row.
    const server = await build()
    const eventId = await givenEvent()
    const later = await givenEvent({
      id: '2b7d9e40-1c3f-4d5a-8b6c-7e8f9a0b1c2d',
      start_date: '2026-12-01',
      end_date: '2026-12-05',
    })
    const member = await givenAccount(['member'])
    const elsewhere = await givenPlace(later, 'Barn')

    expect((await offer(server, member.cookie, { title: 'x', place_id: elsewhere })).statusCode).toBe(400)

    const id = (await offer(server, member.cookie, { title: 'y' })).json().session.id
    expect((await editDream(server, member.cookie, id, { place_id: elsewhere })).statusCode).toBe(400)

    // The passing sibling: this burn's own lane is accepted, so the check refuses
    // the pairing rather than every place.
    const ours = await givenPlace(eventId, 'Temple')
    expect((await editDream(server, member.cookie, id, { place_id: ours })).statusCode).toBe(200)
  })

  it('refuses a place that does not exist', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])

    expect((await offer(server, member.cookie, { title: 'x', place_id: randomUUID() })).statusCode).toBe(400)

    const id = (await offer(server, member.cookie, { title: 'y' })).json().session.id
    expect((await editDream(server, member.cookie, id, { place_id: randomUUID() })).statusCode).toBe(400)
  })

  it('refuses a slot that ends before it starts', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])

    const response = await offer(server, member.cookie, {
      title: 'Backwards',
      time_slot_start: SLOT.time_slot_end,
      time_slot_end: SLOT.time_slot_start,
    })

    expect(response.statusCode).toBe(400)
  })

  it('refuses half a slot at creation', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])

    expect(
      (await offer(server, member.cookie, { title: 'x', time_slot_start: SLOT.time_slot_start })).statusCode,
    ).toBe(400)
  })

  it('refuses a single end that would leave half a slot on the stored row', async () => {
    // The case the schema cannot see: the body carries one end, and whether that
    // is whole depends on the row. Composed into the WHERE rather than compared
    // after a read.
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])
    const id = (await offer(server, member.cookie, { title: 'Unscheduled' })).json().session.id

    const response = await editDream(server, member.cookie, id, { time_slot_start: SLOT.time_slot_start })

    expect(response.statusCode).toBe(400)
    const [row] = await db().select().from(session).where(eq(session.id, id))
    expect(row?.time_slot_start).toBeNull()
  })

  it('refuses a single end that would invert the stored slot', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])
    const id = (await offer(server, member.cookie, { title: 'Scheduled', ...SLOT })).json().session.id

    const late = await editDream(server, member.cookie, id, { time_slot_start: '2026-08-02T23:00:00.000Z' })
    const early = await editDream(server, member.cookie, id, { time_slot_end: '2026-08-02T09:00:00.000Z' })

    expect([late.statusCode, early.statusCode]).toEqual([400, 400])
    const [row] = await db().select().from(session).where(eq(session.id, id))
    expect(row?.time_slot_start).toBe(SLOT.time_slot_start)
    expect(row?.time_slot_end).toBe(SLOT.time_slot_end)
  })

  it('accepts a single end that keeps the slot whole', async () => {
    // The passing sibling: the condition must not refuse an ordinary reschedule.
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])
    const id = (await offer(server, member.cookie, { title: 'Scheduled', ...SLOT })).json().session.id

    const response = await editDream(server, member.cookie, id, {
      time_slot_end: '2026-08-02T21:00:00.000Z',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().session.time_slot_end).toBe('2026-08-02T21:00:00.000Z')
  })

  it('refuses clearing one end alone, and allows clearing both', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])
    const id = (await offer(server, member.cookie, { title: 'Scheduled', ...SLOT })).json().session.id

    expect((await editDream(server, member.cookie, id, { time_slot_start: null })).statusCode).toBe(400)

    const cleared = await editDream(server, member.cookie, id, {
      time_slot_start: null,
      time_slot_end: null,
    })
    expect(cleared.statusCode).toBe(200)
    expect(cleared.json().session.time_slot_start).toBeNull()
  })

  it('unschedules by clearing the place without touching the time', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenAccount(['member'])
    const temple = await givenPlace(eventId)
    const id = (await offer(server, member.cookie, { title: 'x', ...SLOT, place_id: temple })).json().session
      .id

    const response = await editDream(server, member.cookie, id, { place_id: null })

    expect(response.statusCode).toBe(200)
    expect(response.json().session.place_id).toBeNull()
    expect(response.json().session.time_slot_start).toBe(SLOT.time_slot_start)
  })

  it('treats an empty edit as a read rather than a 500', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])
    const id = (await offer(server, member.cookie, { title: 'Sunrise yoga' })).json().session.id

    const response = await editDream(server, member.cookie, id, {})

    expect(response.statusCode).toBe(200)
    expect(response.json().session.title).toBe('Sunrise yoga')
  })

  it('answers 404 for an empty edit of a dream that is not there', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])

    expect((await editDream(server, member.cookie, randomUUID(), {})).statusCode).toBe(404)
  })

  it('answers 404 when editing or deleting a dream that is not there', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])

    expect((await editDream(server, member.cookie, randomUUID(), { title: 'x' })).statusCode).toBe(404)
    expect((await drop(server, member.cookie, randomUUID())).statusCode).toBe(404)
  })

  it('withdraws one', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])
    const id = (await offer(server, member.cookie, { title: 'Sunrise yoga' })).json().session.id

    expect((await drop(server, member.cookie, id)).statusCode).toBe(204)
    expect((await list(server, member.cookie)).json().sessions).toEqual([])
  })

  it('lets any member arrange the schedule, not only whoever offered it', async () => {
    // #20: the schedule belongs to the members, not to the dream's host.
    const server = await build()
    const eventId = await givenEvent()
    const host = await givenAccount(['member'])
    const someone = await givenAccount(['member'])
    const temple = await givenPlace(eventId)
    const id = (await offer(server, host.cookie, { title: 'Sunrise yoga' })).json().session.id

    const response = await editDream(server, someone.cookie, id, { ...SLOT, place_id: temple })

    expect(response.statusCode).toBe(200)
  })

  it('sorts scheduled dreams by when they happen, and the unscheduled last', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])
    await offer(server, member.cookie, { title: 'Offered only' })
    await offer(server, member.cookie, {
      title: 'Later',
      time_slot_start: '2026-08-03T10:00:00.000Z',
      time_slot_end: '2026-08-03T11:00:00.000Z',
    })
    await offer(server, member.cookie, { title: 'Earlier', ...SLOT })

    const titles = (await list(server, member.cookie))
      .json()
      .sessions.map((row: { title: string }) => row.title)

    expect(titles).toEqual(['Earlier', 'Later', 'Offered only'])
  })

  it('leaves a finished burn\u2019s dreams alone, even to whoever noted the id', async () => {
    // Every other member-facing route scopes to the burn that is open. A dream
    // from a finished burn is history: still visible in a past-events view one
    // day, not still editable by anyone who kept the URL.
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])

    const finished = randomUUID()
    await db()
      .insert(event)
      .values({
        id: finished,
        name: 'Last spring',
        slug: `past-${finished.slice(0, 8)}`,
        start_date: '2026-05-01',
        end_date: '2026-05-05',
        member_cap: 42,
        created_at: NOW,
      })
    const old = randomUUID()
    await db().insert(session).values({ id: old, event_id: finished, title: 'Last year' })

    expect((await editDream(server, member.cookie, old, { title: 'Rewritten' })).statusCode).toBe(404)
    expect((await drop(server, member.cookie, old)).statusCode).toBe(404)

    const [row] = await db().select().from(session).where(eq(session.id, old))
    expect(row?.title).toBe('Last year')
  })

  it('refuses everyone who is neither a member nor an admin', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])
    const applicant = await givenAccount([])
    const id = (await offer(server, member.cookie, { title: 'Sunrise yoga' })).json().session.id

    for (const [cookie, expected] of [
      [undefined, 401],
      [applicant.cookie, 403],
    ] as const) {
      expect((await list(server, cookie)).statusCode).toBe(expected)
      expect((await offer(server, cookie, { title: 'Theirs' })).statusCode).toBe(expected)
      expect((await editDream(server, cookie, id, { title: 'Theirs' })).statusCode).toBe(expected)
      expect((await drop(server, cookie, id)).statusCode).toBe(expected)
    }

    expect((await list(server, member.cookie)).json().sessions).toHaveLength(1)
  })

  it('lets an organiser holding admin alone arrange the burn they are setting up', async () => {
    // #200: `getMyBurns` is `requireApproved`, so this account gets a working burn
    // selector — and then every page it chose a burn for turned it away. The lanes,
    // the register and the options were already open to them; the timetable is the
    // same shared furniture.
    const server = await build()
    await givenEvent()
    const organiser = await givenAccount(['admin'])

    const offered = await offer(server, organiser.cookie, { title: 'Opening circle' })
    expect(offered.statusCode).toBe(201)
    const id = offered.json().session.id

    expect((await list(server, organiser.cookie)).json().sessions).toHaveLength(1)
    expect((await editDream(server, organiser.cookie, id, { title: 'Opening ceremony' })).statusCode).toBe(
      200,
    )
    expect((await drop(server, organiser.cookie, id)).statusCode).toBe(204)
  })

  it('refuses a stray key rather than silently ignoring it', async () => {
    const server = await build()
    await givenEvent()
    const member = await givenAccount(['member'])

    expect((await offer(server, member.cookie, { title: 'x', location: 'Temple' })).statusCode).toBe(400)
  })
})

describe('a place a dream is standing in', () => {
  const removePlace = (server: FastifyInstance, cookie: string, id: string) =>
    server.inject({ method: 'DELETE', url: `/api/places/${id}`, headers: { cookie } })

  it('cannot be deleted out from under it', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin', 'member'])
    const temple = await givenPlace(eventId)
    await offer(server, admin.cookie, { title: 'Sunrise yoga', ...SLOT, place_id: temple })

    const response = await removePlace(server, admin.cookie, temple)

    expect(response.statusCode).toBe(409)
    expect((await db().select().from(place)).map((row) => row.id)).toEqual([temple])
  })

  it('is deleted once nothing stands in it', async () => {
    // The passing sibling: the refusal must be about the dream, not about
    // deleting places at all.
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin', 'member'])
    const temple = await givenPlace(eventId)
    const id = (await offer(server, admin.cookie, { title: 'x', ...SLOT, place_id: temple })).json().session
      .id
    await editDream(server, admin.cookie, id, { place_id: null })

    expect((await removePlace(server, admin.cookie, temple)).statusCode).toBe(204)
  })
})

describe('a dream belongs to the burn it names', () => {
  const LATER = '2b7d9e40-1c3f-4d5a-8b6c-7e8f9a0b1c2d'
  const ENDED = '3c8e0f51-2d4a-4e6b-9c7d-8f9a0b1c2d3e'

  it('is offered at the burn asked for, not whichever one is next', async () => {
    // The selector offers every burn still to come, so a dream can be offered for
    // the one after next. That could not be said at all while these routes were
    // scoped to the soonest-ending burn.
    const server = await build()
    await givenEvent()
    await givenEvent({ id: LATER, start_date: '2026-12-01', end_date: '2026-12-05' })
    const member = await givenAccount(['member'])

    const offered = await offer(server, member.cookie, { title: 'Winter sauna' }, LATER)

    expect(offered.statusCode).toBe(201)
    expect(offered.json().session.event_id).toBe(LATER)
    expect((await list(server, member.cookie, LATER)).json().sessions).toHaveLength(1)
    expect((await list(server, member.cookie)).json().sessions).toEqual([])
  })

  it('can still be edited and withdrawn at a burn that is not the next one', async () => {
    // The passing sibling for the refusal below: what the guard rejects is a burn
    // that has *ended*, not every burn other than the soonest.
    const server = await build()
    await givenEvent()
    await givenEvent({ id: LATER, start_date: '2026-12-01', end_date: '2026-12-05' })
    const member = await givenAccount(['member'])
    const id = (await offer(server, member.cookie, { title: 'Winter sauna' }, LATER)).json().session.id

    expect((await editDream(server, member.cookie, id, { title: 'Renamed' })).statusCode).toBe(200)
    expect((await drop(server, member.cookie, id)).statusCode).toBe(204)
  })

  it('refuses to be offered at, edited at, or withdrawn from a burn that has ended', async () => {
    const server = await build()
    await givenEvent({ id: ENDED, start_date: '2025-08-01', end_date: '2025-08-05' })
    const member = await givenAccount(['member'])
    const id = randomUUID()
    await db().insert(session).values({ id, event_id: ENDED, title: 'Last summer' })

    expect((await offer(server, member.cookie, { title: 'x' }, ENDED)).statusCode).toBe(404)
    expect((await editDream(server, member.cookie, id, { title: 'Rewritten' })).statusCode).toBe(404)
    expect((await drop(server, member.cookie, id)).statusCode).toBe(404)
    expect((await db().select().from(session))[0]?.title).toBe('Last summer')
  })

  it('still reads a finished burn’s dreams, which are its record', async () => {
    const server = await build()
    await givenEvent({ id: ENDED, start_date: '2025-08-01', end_date: '2025-08-05' })
    const member = await givenAccount(['member'])
    await db().insert(session).values({ id: randomUUID(), event_id: ENDED, title: 'Last summer' })

    const response = await list(server, member.cookie, ENDED)

    expect(response.statusCode).toBe(200)
    expect(response.json().sessions.map((dream: { title: string }) => dream.title)).toEqual(['Last summer'])
  })
})

describe('helping with a dream', () => {
  it('adds the caller, by name, and takes them off again', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAttending(eventId)
    await db().update(account).set({ name: 'Ada' }).where(eq(account.id, ada.id))
    const id = (await offer(server, ada.cookie, { title: 'Sunrise yoga' })).json().session.id

    const joined = await helping(server, ada, id, 'POST')
    expect(joined.statusCode).toBe(200)
    expect(joined.json().session.helpers).toEqual([{ account_id: ada.id, name: 'Ada' }])

    const left = await helping(server, ada, id, 'DELETE')
    expect(left.statusCode).toBe(200)
    expect(left.json().session.helpers).toEqual([])
  })

  it('resolves the name at read time, so correcting it corrects the list', async () => {
    // The account carries the person, so a name is corrected in one place.
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAttending(eventId)
    const id = (await offer(server, ada.cookie, { title: 'Sunrise yoga' })).json().session.id
    await helping(server, ada, id, 'POST')

    await db().update(account).set({ name: 'Ada Lovelace' }).where(eq(account.id, ada.id))

    expect((await list(server, ada.cookie)).json().sessions[0].helpers).toEqual([
      { account_id: ada.id, name: 'Ada Lovelace' },
    ])
  })

  it('is the same after two clicks as after one', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAttending(eventId)
    const id = (await offer(server, ada.cookie, { title: 'Sunrise yoga' })).json().session.id

    await helping(server, ada, id, 'POST')
    const again = await helping(server, ada, id, 'POST')

    expect(again.statusCode).toBe(200)
    expect(again.json().session.helpers).toHaveLength(1)
  })

  it('takes somebody off who was never on, rather than failing', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAttending(eventId)
    const id = (await offer(server, ada.cookie, { title: 'Sunrise yoga' })).json().session.id

    const response = await helping(server, ada, id, 'DELETE')

    expect(response.statusCode).toBe(200)
    expect(response.json().session.helpers).toEqual([])
  })

  it('lets somebody organising but not coming put a pair of hands down (#350)', async () => {
    // Arranging the burn is a job you can hold without attending it, and the lead-roles
    // register has always let any approved account appoint. The 👉 on this strip used to
    // be a button that always failed.
    const server = await build()
    const eventId = await givenEvent()
    const organiser = await givenAccount(['admin'])
    const ada = await givenAttending(eventId)
    await db().update(account).set({ name: 'Ada' }).where(eq(account.id, ada.id))
    const id = (await offer(server, ada.cookie, { title: 'Sunrise yoga' })).json().session.id

    const put = await helping(server, organiser, id, 'POST', ada.id)

    expect(put.statusCode).toBe(200)
    expect(put.json().session.helpers).toEqual([{ account_id: ada.id, name: 'Ada' }])

    const off = await helping(server, organiser, id, 'DELETE', ada.id)

    expect(off.statusCode).toBe(200)
    expect(off.json().session.helpers).toEqual([])
  })

  it('still refuses to put down somebody who is not coming', async () => {
    // The other half of #350: the caller's attendance stopped mattering, the named
    // person's did not — a dream is run by people who are there.
    const server = await build()
    const eventId = await givenEvent()
    const organiser = await givenAccount(['admin'])
    const elsewhere = await givenAccount(['member'])
    const coming = await givenAttending(eventId)
    const id = (await offer(server, coming.cookie, { title: 'Sunrise yoga' })).json().session.id

    expect((await helping(server, organiser, id, 'POST', elsewhere.id)).statusCode).toBe(400)
    expect((await helping(server, organiser, id, 'DELETE', elsewhere.id)).statusCode).toBe(400)
  })

  it('refuses a heart from a member who is not coming to that burn', async () => {
    // A 400, not a 403: they are a member in good standing; the pairing is wrong. A
    // heart is keyed by the caller's own attendance, so unlike appointing it needs one.
    const server = await build()
    await givenEvent()
    const elsewhere = await givenAccount(['member'])
    const coming = await givenAttending(OPEN_BURN)
    const id = (await offer(server, coming.cookie, { title: 'Sunrise yoga' })).json().session.id

    expect((await selfService(server, elsewhere.cookie, id, 'support', 'POST')).statusCode).toBe(400)
    expect((await selfService(server, elsewhere.cookie, id, 'support', 'DELETE')).statusCode).toBe(400)
  })

  it('refuses a dream that does not exist, and one at a burn that has ended', async () => {
    const server = await build()
    const ended = randomUUID()
    await givenEvent({ id: ended, start_date: '2025-08-01', end_date: '2025-08-05' })
    const ada = await givenAttending(ended)
    const old = randomUUID()
    await db().insert(session).values({ id: old, event_id: ended, title: 'Last summer' })

    expect((await helping(server, ada, randomUUID(), 'POST')).statusCode).toBe(404)
    expect((await helping(server, ada, old, 'POST')).statusCode).toBe(404)
    expect((await selfService(server, ada.cookie, old, 'support', 'POST')).statusCode).toBe(404)
  })

  it('needs somebody who is in, like everything else on the schedule', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAttending(eventId)
    const applicant = await givenAccount([])
    const id = (await offer(server, ada.cookie, { title: 'Sunrise yoga' })).json().session.id

    expect((await helping(server, undefined, id, 'POST')).statusCode).toBe(401)
    expect((await selfService(server, undefined, id, 'support', 'POST')).statusCode).toBe(401)
    expect((await helping(server, applicant, id, 'POST')).statusCode).toBe(403)
    expect((await selfService(server, applicant.cookie, id, 'support', 'POST')).statusCode).toBe(403)
  })

  it('tells an organiser putting their own hand up that they are not coming, rather than refusing the role', async () => {
    // The guard opens to `approved` (#200), and the named person's attendance still
    // does its job — here the organiser names themselves, so a hand put up on a burn
    // nobody said they were attending is the pairing being wrong, not the account
    // being unwelcome. Naming somebody who *is* coming works, which is #350.
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAttending(eventId)
    const organiser = await givenAccount(['admin'])
    const id = (await offer(server, ada.cookie, { title: 'Sunrise yoga' })).json().session.id

    expect((await helping(server, organiser, id, 'POST')).statusCode).toBe(400)
    expect((await selfService(server, organiser.cookie, id, 'support', 'POST')).statusCode).toBe(400)
  })
})

describe('supporting a dream', () => {
  it('counts one heart per person, however many times they click', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAttending(eventId)
    const bea = await givenAttending(eventId)
    const id = (await offer(server, ada.cookie, { title: 'Sunrise yoga' })).json().session.id

    await selfService(server, ada.cookie, id, 'support', 'POST')
    await selfService(server, ada.cookie, id, 'support', 'POST')
    const second = await selfService(server, bea.cookie, id, 'support', 'POST')

    expect(second.json().session.support_count).toBe(2)
  })

  it('names whoever gave one, so the page can show their faces', async () => {
    // The count used to be all there was, and could be: a heart said nothing about
    // who. The page says it now (#251), so the answer has to carry it.
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAttending(eventId)
    const bea = await givenAttending(eventId)
    const id = (await offer(server, ada.cookie, { title: 'Sunrise yoga' })).json().session.id

    await selfService(server, ada.cookie, id, 'support', 'POST')
    const both = await selfService(server, bea.cookie, id, 'support', 'POST')

    const ids = both
      .json()
      .session.supporters.map((who: { account_id: string }) => who.account_id)
      .toSorted()
    expect(ids).toEqual([ada.id, bea.id].toSorted())
    expect(both.json().session.supporters).toHaveLength(2)
  })

  it('says whose heart it is, and only to them', async () => {
    // Without the per-reader half everybody would see a filled heart the moment
    // anybody gave one.
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAttending(eventId)
    const bea = await givenAttending(eventId)
    const id = (await offer(server, ada.cookie, { title: 'Sunrise yoga' })).json().session.id

    await selfService(server, ada.cookie, id, 'support', 'POST')

    expect((await list(server, ada.cookie)).json().sessions[0].supported_by_me).toBe(true)
    expect((await list(server, bea.cookie)).json().sessions[0].supported_by_me).toBe(false)
    expect((await list(server, bea.cookie)).json().sessions[0].support_count).toBe(1)
  })

  it('takes a heart back, leaving everybody else’s', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAttending(eventId)
    const bea = await givenAttending(eventId)
    const id = (await offer(server, ada.cookie, { title: 'Sunrise yoga' })).json().session.id
    await selfService(server, ada.cookie, id, 'support', 'POST')
    await selfService(server, bea.cookie, id, 'support', 'POST')

    const withdrawn = await selfService(server, ada.cookie, id, 'support', 'DELETE')

    expect(withdrawn.json().session.support_count).toBe(1)
    expect(withdrawn.json().session.supported_by_me).toBe(false)
    expect((await list(server, bea.cookie)).json().sessions[0].supported_by_me).toBe(true)
  })

  it('starts a new dream with nobody helping and no hearts', async () => {
    const server = await build()
    await givenEvent()
    const ada = await givenAttending(OPEN_BURN)

    const offered = await offer(server, ada.cookie, { title: 'Sunrise yoga' })

    expect(offered.json().session).toMatchObject({ helpers: [], support_count: 0, supported_by_me: false })
  })

  it('keeps the helpers and hearts across an ordinary edit', async () => {
    // `.returning()` gives back a row rather than a dream, so the fields it does not
    // know about have to be attached again or a save looks like everybody let go.
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAttending(eventId)
    const id = (await offer(server, ada.cookie, { title: 'Sunrise yoga' })).json().session.id
    await helping(server, ada, id, 'POST')
    await selfService(server, ada.cookie, id, 'support', 'POST')

    const renamed = await editDream(server, ada.cookie, id, { title: 'Sunrise stretching' })

    expect(renamed.json().session).toMatchObject({
      title: 'Sunrise stretching',
      support_count: 1,
      supported_by_me: true,
    })
    expect(renamed.json().session.helpers).toHaveLength(1)
  })

  it('keeps them across a PATCH that changes nothing, which reads rather than writes', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAttending(eventId)
    const id = (await offer(server, ada.cookie, { title: 'Sunrise yoga' })).json().session.id
    await selfService(server, ada.cookie, id, 'support', 'POST')

    const unchanged = await editDream(server, ada.cookie, id, {})

    expect(unchanged.statusCode).toBe(200)
    expect(unchanged.json().session).toMatchObject({ support_count: 1, supported_by_me: true })
  })
})

describe('telling somebody a dream role moved', () => {
  const setUp = async (deliver: Delivery) => {
    const server = await build(deliver)
    await givenEvent()
    const ada = await givenAttending(OPEN_BURN)
    const bea = await givenAttending(OPEN_BURN)
    const id = (await offer(server, ada.cookie, { title: 'Sunrise yoga' })).json().session.id

    return { server, ada, bea, id }
  }

  it('tells somebody put on a dream by anybody but themselves', async () => {
    const deliver = vi.fn<Delivery>(() => Promise.resolve('sent'))
    const { server, ada, bea, id } = await setUp(deliver)
    await givenSubscribed(bea.id)

    await helping(server, ada, id, 'POST', bea.id)

    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1))
    expect(messagesFrom(deliver)).toEqual(['You are helping with Sunrise yoga'])
  })

  it('says nothing to somebody who put their own hand up', async () => {
    const deliver = vi.fn<Delivery>(() => Promise.resolve('sent'))
    const { server, ada, id } = await setUp(deliver)
    await givenSubscribed(ada.id)

    await helping(server, ada, id, 'POST')

    expect(deliver).not.toHaveBeenCalled()
  })

  it('says nothing the second time somebody is put on', async () => {
    // A repeated 👉, or a second tab. `.onConflictDoNothing()` makes the write
    // idempotent; without `.returning()` the notification is not.
    const deliver = vi.fn<Delivery>(() => Promise.resolve('sent'))
    const { server, ada, bea, id } = await setUp(deliver)
    await givenSubscribed(bea.id)
    await helping(server, ada, id, 'POST', bea.id)
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1))
    deliver.mockClear()

    await helping(server, ada, id, 'POST', bea.id)

    expect(deliver).not.toHaveBeenCalled()
  })

  it('tells somebody taken off by anybody but themselves', async () => {
    const deliver = vi.fn<Delivery>(() => Promise.resolve('sent'))
    const { server, ada, bea, id } = await setUp(deliver)
    await givenSubscribed(bea.id)
    await helping(server, bea, id, 'POST')
    deliver.mockClear()

    await helping(server, ada, id, 'DELETE', bea.id)

    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1))
    expect(messagesFrom(deliver)).toEqual(['You are no longer helping with Sunrise yoga'])
  })

  it('says nothing when nobody was actually taken off', async () => {
    // Bea was never on it. Without the guard she is told she has been dropped from
    // something she never joined — which is what a second tab makes ordinary.
    const deliver = vi.fn<Delivery>(() => Promise.resolve('sent'))
    const { server, ada, bea, id } = await setUp(deliver)
    await givenSubscribed(bea.id)

    await helping(server, ada, id, 'DELETE', bea.id)

    expect(deliver).not.toHaveBeenCalled()
  })

  it('tells both ends when the facilitator moves', async () => {
    const deliver = vi.fn<Delivery>(() => Promise.resolve('sent'))
    const { server, ada, bea, id } = await setUp(deliver)
    const cai = await givenAttending(OPEN_BURN)
    await givenSubscribed(bea.id)
    await givenSubscribed(cai.id)
    await editDream(server, ada.cookie, id, { facilitator_account_id: bea.id })
    deliver.mockClear()

    await editDream(server, ada.cookie, id, { facilitator_account_id: cai.id })

    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(2))
    expect(messagesFrom(deliver).toSorted()).toEqual([
      'You are facilitating Sunrise yoga',
      'You are no longer facilitating Sunrise yoga',
    ])
  })

  it('announces nothing when the facilitator was not what changed', async () => {
    // The field is set through the general PATCH, so a rename must stay silent.
    const deliver = vi.fn<Delivery>(() => Promise.resolve('sent'))
    const { server, ada, bea, id } = await setUp(deliver)
    await givenSubscribed(bea.id)
    await editDream(server, ada.cookie, id, { facilitator_account_id: bea.id })
    deliver.mockClear()

    await editDream(server, ada.cookie, id, { title: 'Sunset yoga' })

    expect(deliver).not.toHaveBeenCalled()
  })
})

describe('moving a dream somebody else has just moved', () => {
  const move = (server: FastifyInstance, cookie: string, id: string, version?: string) =>
    server.inject({
      method: 'PATCH',
      url: `/api/sessions/${id}`,
      headers: { cookie, ...(version === undefined ? {} : { 'if-match': version }) },
      payload: { title: 'Sauna ritual' },
    })

  it('refuses one written against no version of the pool, and against an old one', async () => {
    const server = await build()
    await givenEvent()
    const ada = await givenAttending(OPEN_BURN)
    const bea = await givenAttending(OPEN_BURN)
    const mine = (await offer(server, ada.cookie, { title: 'Sauna', description: '' })).json().session.id
    const theirs = (await offer(server, bea.cookie, { title: 'Fire spinning', description: '' })).json()
      .session.id

    const asAdaSawIt = String((await list(server, ada.cookie)).headers.etag)

    expect((await move(server, ada.cookie, mine)).statusCode).toBe(428)

    // Bea edits her own dream, which moves the pool Ada is holding a version of.
    expect((await editDream(server, bea.cookie, theirs, { title: 'Poi' })).statusCode).toBe(200)

    const refused = await move(server, ada.cookie, mine, asAdaSawIt)
    expect(refused.statusCode).toBe(412)
    // Carrying the pool as it stands, so the page can say what changed.
    expect(refused.json().sessions.map((dream: { title: string }) => dream.title)).toContain('Poi')
  })

  it('takes one written against the version it was handed', async () => {
    const server = await build()
    await givenEvent()
    const ada = await givenAttending(OPEN_BURN)
    const mine = (await offer(server, ada.cookie, { title: 'Sauna', description: '' })).json().session.id

    const current = String((await list(server, ada.cookie)).headers.etag)

    expect((await move(server, ada.cookie, mine, current)).statusCode).toBe(200)
  })
})
