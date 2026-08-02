import type { FastifyInstance } from 'fastify'

import { publicSessionSchema } from '@sage-burner/shared'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, attendance, event, place, session } from '../db/schema.ts'

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
      created_at: NOW,
    })
  return id
}

const givenPlace = async (name = 'Temple', color: 'yellow' | 'grey' = 'yellow') => {
  const id = randomUUID()
  await db().insert(place).values({ id, order: 0, name, emoji: '🛕', color })
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
      host_account_id: hostId,
      description: over.description ?? 'Bring a cup.',
      // `in` rather than `??`: a deliberate null is the whole point of the
      // unscheduled case, and `null ?? default` quietly schedules it again.
      time_slot_start: 'time_slot_start' in over ? over.time_slot_start : '2026-08-02T18:00:00.000Z',
      time_slot_end: 'time_slot_end' in over ? over.time_slot_end : '2026-08-02T20:00:00.000Z',
      place_id: over.place_id ?? null,
    })
  return id
}

const feed = (server: FastifyInstance, eventId: string) =>
  server.inject({ method: 'GET', url: `/events/${eventId}/schedule.ics` })

describe('the public calendar feed', () => {
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

  it('carries a scheduled dream, with its place and colour', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const host = await givenHost()
    const temple = await givenPlace()
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
    const shed = await givenPlace('Shed', 'grey')
    await givenDream(eventId, host, { place_id: shed })

    expect((await feed(server, eventId)).body).toContain('COLOR:gray')
  })

  it('leaves out a dream nobody has scheduled', async () => {
    // The acceptance criterion of #20: an unscheduled dream is valid and does
    // not belong in a calendar.
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
    // The passing sibling of the LOCATION test: a scheduled dream is in the
    // programme whether or not anyone has decided where it happens. The left
    // join is what makes that true, and an inner one would silently lose it.
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
    // The acceptance criterion, asserted against the rendered feed rather than
    // the query, so a join added later cannot widen it quietly.
    //
    // It is a denylist, and a denylist only catches what someone thought of — so
    // it is seeded with every field the fixtures above carry, and adding a column
    // to `account` or `attendance` means adding it here too. The structural guard
    // is elsewhere: `schemas.test.ts` pins the exact key set of
    // `publicSessionFields`, which fails when a field is added rather than when
    // one leaks.
    const server = await build()
    const eventId = await givenEvent()
    const host = await givenHost()
    const temple = await givenPlace()
    await givenDream(eventId, host, { place_id: temple })
    await db().insert(attendance).values({
      id: randomUUID(),
      event_id: eventId,
      account_id: host,
      joined_at: NOW,
      payment_status: 'paid',
      payment_date: '2026-07-01',
      lodging_option_id: null,
      helping_other: 'Sauna tending',
      notes: 'arriving late',
    })

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
    // The guard rail, exercised rather than merely declared. `publicSessionSchema`
    // strips what it does not know, so widening the select cannot widen the feed
    // — a field has to be added to that schema too, and `schemas.test.ts` fails
    // when one is.
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
      host_account_id: host,
      allergies_notes: 'peanuts',
    })

    expect(smuggled.success).toBe(true)
    expect(smuggled.success && 'host_account_id' in smuggled.data).toBe(false)
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
    // The DST case #21 asks for. Both are emitted in UTC, so the server's own
    // timezone never reaches the output — an October burn is the one where a
    // local-time renderer would drift by an hour.
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
