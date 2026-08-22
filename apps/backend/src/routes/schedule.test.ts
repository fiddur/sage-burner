import type { FastifyInstance } from 'fastify'

import { publicSessionSchema } from '@sage-burner/shared'
import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, attendance, event, meeting, place, session } from '../db/schema.ts'

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

const givenEvent = async (name = 'Summer burn') => {
  const id = randomUUID()
  await db()
    .insert(event)
    .values({
      id,
      name,
      slug: `burn-${id.slice(0, 8)}`,
      start_date: '2026-08-01',
      end_date: '2026-08-05',
      member_cap: 42,
      feed_token: `token-${id}`,
      created_at: NOW,
    })
  return id
}

const givenPlace = async (eventId: string, name = 'Temple', color: 'yellow' | 'grey' = 'yellow') => {
  const id = randomUUID()
  await db().insert(place).values({ id, event_id: eventId, order: 0, name, emoji: '🛕', color })
  return id
}

const givenHost = async () => {
  const id = randomUUID()
  await db().insert(account).values({
    id,
    email: 'ada.lovelace@example.org',
    password_hash: null,
    name: 'Ada Lovelace',
    contact: 'signal: +46 70 000 00 00',
    allergies_notes: 'peanuts, shellfish',
    created_at: NOW,
  })
  await db().insert(accountRole).values({ account_id: id, role: 'member' })
  return id
}

const comingTo = async (eventId: string, accountId: string) => {
  const [existing] = await db()
    .select({ id: attendance.id })
    .from(attendance)
    .where(and(eq(attendance.event_id, eventId), eq(attendance.account_id, accountId)))
    .limit(1)

  if (existing !== undefined) return existing.id

  const id = randomUUID()
  await db().insert(attendance).values({ id, event_id: eventId, account_id: accountId, joined_at: NOW })

  return id
}

const givenDream = async (
  eventId: string,
  hostId: string,
  over: Partial<{
    title: string
    description: string
    time_slot_start: string | null
    time_slot_end: string | null
    place_id: string | null
  }> = {},
) => {
  const id = randomUUID()
  await db()
    .insert(session)
    .values({
      id,
      event_id: eventId,
      title: over.title ?? 'Cacao ceremony',
      facilitator_attendance_id: await comingTo(eventId, hostId),
      description: over.description ?? 'Bring a cup.',
      time_slot_start: 'time_slot_start' in over ? over.time_slot_start : '2026-08-02T18:00:00.000Z',
      time_slot_end: 'time_slot_end' in over ? over.time_slot_end : '2026-08-02T20:00:00.000Z',
      place_id: over.place_id ?? null,
    })
  return id
}

const givenMeeting = async (
  eventId: string,
  over: Partial<{
    title: string
    starts_at: string
    ends_at: string | null
    link: string | null
    notes: string
  }> = {},
) => {
  const id = randomUUID()
  await db()
    .insert(meeting)
    .values({
      id,
      event_id: eventId,
      title: over.title ?? 'Planning call',
      starts_at: over.starts_at ?? '2026-07-20T17:00:00.000Z',
      ends_at: 'ends_at' in over ? (over.ends_at ?? null) : null,
      link: over.link ?? null,
      notes: over.notes ?? '',
      created_at: NOW,
    })
  return id
}

const feed = (server: FastifyInstance, eventId: string) =>
  server.inject({ method: 'GET', url: `/calendar/token-${eventId}/schedule.ics` })

describe('the public calendar feed', () => {
  it('answers nothing at the burn’s id, which the public homepage gives away', async () => {
    const server = await build()
    const eventId = await givenEvent()

    expect(
      (await server.inject({ method: 'GET', url: `/calendar/${eventId}/schedule.ics` })).statusCode,
    ).toBe(404)
  })

  it('answers nothing at a token that names no burn', async () => {
    const server = await build()
    await givenEvent()

    expect(
      (await server.inject({ method: 'GET', url: '/calendar/not-a-token/schedule.ics' })).statusCode,
    ).toBe(404)
  })

  it('is served as a calendar, without signing in', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const host = await givenHost()
    await givenDream(eventId, host)

    const response = await feed(server, eventId)

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/calendar')
    expect(response.body).toContain('BEGIN:VCALENDAR')
  })

  it('leaves a withdrawn dream out, though its slot is still on the row', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const host = await givenHost()
    const id = await givenDream(eventId, host)
    await db().update(session).set({ withdrawn_at: '2026-07-02T00:00:00.000Z' }).where(eq(session.id, id))

    expect((await feed(server, eventId)).body).not.toContain(`UID:${id}@sage-burner`)
  })

  it('carries a scheduled dream, with its place and colour', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const host = await givenHost()
    const temple = await givenPlace(eventId)
    const id = await givenDream(eventId, host, { place_id: temple })

    const body = (await feed(server, eventId)).body

    expect(body).toContain(`UID:${id}@sage-burner`)
    expect(body).toContain('SUMMARY:Cacao ceremony')
    expect(body).toContain('DTSTART:20260802T180000Z')
    expect(body).toContain('DTEND:20260802T200000Z')
    expect(body).toContain('LOCATION:🛕 Temple')
    expect(body).toContain('COLOR:yellow')
  })

  it('spells a grey lane the way CSS3 does', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const host = await givenHost()
    const shed = await givenPlace(eventId, 'Shed', 'grey')
    await givenDream(eventId, host, { place_id: shed })

    expect((await feed(server, eventId)).body).toContain('COLOR:gray')
  })

  it('leaves out a dream nobody has scheduled', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const host = await givenHost()
    await givenDream(eventId, host, { title: 'Offered only', time_slot_start: null, time_slot_end: null })
    await givenDream(eventId, host, { title: 'Scheduled' })

    const body = (await feed(server, eventId)).body

    expect(body).toContain('SUMMARY:Scheduled')
    expect(body).not.toContain('Offered only')
  })

  it('carries a dream with no place at all, rather than dropping it', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const host = await givenHost()
    await givenDream(eventId, host, { title: 'Somewhere', place_id: null })

    const body = (await feed(server, eventId)).body

    expect(body).toContain('SUMMARY:Somewhere')
    expect(body).not.toContain('LOCATION')
  })

  it('carries only this burn, not another one running alongside', async () => {
    const server = await build()
    const mine = await givenEvent('Summer burn')
    const other = await givenEvent('Someone else')
    const host = await givenHost()
    await givenDream(mine, host, { title: 'Ours' })
    await givenDream(other, host, { title: 'Theirs' })

    const body = (await feed(server, mine)).body

    expect(body).toContain('SUMMARY:Ours')
    expect(body).not.toContain('Theirs')
  })

  it('is an empty calendar for a burn with nothing scheduled, not a 404', async () => {
    const server = await build()
    const eventId = await givenEvent()

    const response = await feed(server, eventId)

    expect(response.statusCode).toBe(200)
    expect(response.body).not.toContain('BEGIN:VEVENT')
    expect(response.body).toContain('END:VCALENDAR')
  })

  it('answers 404 for a burn that does not exist', async () => {
    const server = await build()

    expect((await feed(server, randomUUID())).statusCode).toBe(404)
  })

  it('leaks no member detail whatsoever', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const host = await givenHost()
    const temple = await givenPlace(eventId)
    await givenDream(eventId, host, { place_id: temple })

    await db()
      .update(attendance)
      .set({
        payment_status: 'paid',
        payment_date: '2026-07-01',
        lodging_option_id: null,
        helping_other: 'Sauna tending',
        notes: 'arriving late',
      })
      .where(and(eq(attendance.event_id, eventId), eq(attendance.account_id, host)))

    const body = (await feed(server, eventId)).body

    for (const secret of [
      'Ada',
      'Lovelace',
      'ada.lovelace@example.org',
      'signal',
      '+46 70 000 00 00',
      'peanuts',
      'shellfish',
      'Hammock',
      'Sauna tending',
      'arriving late',
      'paid',
      host,
    ]) {
      expect(body, secret).not.toContain(secret)
    }
  })

  it('strips a field the public shape does not name, even when the query selects it', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const host = await givenHost()
    await givenDream(eventId, host)

    const body = (await feed(server, eventId)).body
    const smuggled = publicSessionSchema.safeParse({
      id: randomUUID(),
      title: 'x',
      description: '',
      time_slot_start: '2026-08-02T18:00:00.000Z',
      time_slot_end: '2026-08-02T20:00:00.000Z',
      location: null,
      color: null,
      facilitator_account_id: host,
      allergies_notes: 'peanuts',
    })

    expect(smuggled.success).toBe(true)
    expect(smuggled.success && 'facilitator_account_id' in smuggled.data).toBe(false)
    expect(smuggled.success && 'allergies_notes' in smuggled.data).toBe(false)
    expect(body).not.toContain('peanuts')
  })

  it('escapes a description rather than letting it break the format', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const host = await givenHost()
    await givenDream(eventId, host, { description: 'Bring: a cup; or two, please' })

    const body = (await feed(server, eventId)).body
    const backslash = String.fromCharCode(92)

    expect(body).toContain(`DESCRIPTION:Bring: a cup${backslash}; or two${backslash}, please`)
  })

  it('renders a winter burn at the same instant as a summer one', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const host = await givenHost()
    await givenDream(eventId, host, {
      title: 'October',
      time_slot_start: '2026-10-25T01:30:00.000Z',
      time_slot_end: '2026-10-25T02:30:00.000Z',
    })

    const body = (await feed(server, eventId)).body

    expect(body).toContain('DTSTART:20261025T013000Z')
    expect(body).toContain('DTEND:20261025T023000Z')
  })

  it('uses CRLF throughout, which is what makes it parse', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const host = await givenHost()
    await givenDream(eventId, host)

    expect((await feed(server, eventId)).body.replaceAll('\r\n', '')).not.toContain('\n')
  })
})

describe('meetings in the feed', () => {
  it('carries a meeting beside the dreams, so one subscription covers both', async () => {
    const server = await build()
    const eventId = await givenEvent()
    await givenMeeting(eventId, { title: 'Planning call' })

    const body = (await feed(server, eventId)).body

    expect(body).toContain('SUMMARY:Planning call')
    expect(body).toContain('DTSTART:20260720T170000Z')
  })

  it('runs an hour when nobody said when it ends, rather than being left out', async () => {
    const server = await build()
    const eventId = await givenEvent()
    await givenMeeting(eventId, { ends_at: null })

    expect((await feed(server, eventId)).body).toContain('DTEND:20260720T180000Z')
  })

  it('keeps the end somebody did give', async () => {
    const server = await build()
    const eventId = await givenEvent()
    await givenMeeting(eventId, { ends_at: '2026-07-20T19:30:00.000Z' })

    expect((await feed(server, eventId)).body).toContain('DTEND:20260720T193000Z')
  })

  it('carries the joining link, which is the one thing a calendar entry has to have', async () => {
    const server = await build()
    const eventId = await givenEvent()
    await givenMeeting(eventId, { link: 'https://meet.example/abc' })

    expect((await feed(server, eventId)).body).toContain('DESCRIPTION:https://meet.example/abc')
  })

  it('leaves the notes out, the feed being readable by whoever holds the address', async () => {
    const server = await build()
    const eventId = await givenEvent()
    await givenMeeting(eventId, { notes: 'the code is 1234' })

    expect((await feed(server, eventId)).body).not.toContain('1234')
  })

  it('answers a burn nobody has scheduled a meeting for with its dreams alone', async () => {
    const server = await build()
    const eventId = await givenEvent()
    await givenDream(eventId, await givenHost())

    expect((await feed(server, eventId)).body).toContain('SUMMARY:Cacao ceremony')
  })
})
