import type { FastifyInstance, LightMyRequestResponse } from 'fastify'

import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, attendance, attendanceHelping, event, eventOption } from '../db/schema.ts'
import { SESSION_COOKIE } from './auth.ts'

/**
 * The organiser's list of who is coming, and recording that they have paid.
 *
 * The ordering is the load-bearing part: it decides who has a place, so the
 * cases worth proving are that paying re-sorts the list and that the cut is
 * derived rather than stored.
 */

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

const cookieFor = (id: string) => {
  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return `${SESSION_COOKIE}=${sessions.issue(id)}`
}

const givenAccount = async (name: string, roles: ('admin' | 'member')[] = ['member']) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({
      id,
      email: `${name.toLowerCase()}-${id.slice(0, 6)}@example.org`,
      password_hash: null,
      name,
      contact: `${name} on discord`,
      allergies_notes: name === 'Ana' ? 'peanuts' : null,
      created_at: NOW,
    })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  return { id, cookie: cookieFor(id) }
}

const givenEvent = async (cap = 42) => {
  const id = randomUUID()
  await db()
    .insert(event)
    .values({
      id,
      name: 'Summer burn',
      slug: `burn-${id.slice(0, 8)}`,
      start_date: '2026-08-01',
      end_date: '2026-08-05',
      member_cap: cap,
      created_at: NOW,
    })
  return id
}

const givenComing = async (eventId: string, accountId: string, joined_at: string, paid = false) => {
  await db()
    .insert(attendance)
    .values({
      id: randomUUID(),
      event_id: eventId,
      account_id: accountId,
      joined_at,
      payment_status: paid ? 'paid' : 'unpaid',
    })
}

const roster = (server: FastifyInstance, cookie: string, eventId: string): Promise<LightMyRequestResponse> =>
  server.inject({ method: 'GET', url: `/api/admin/events/${eventId}/roster`, headers: { cookie } })

const setPayment = (
  server: FastifyInstance,
  cookie: string,
  eventId: string,
  accountId: string,
  payload: Record<string, unknown>,
): Promise<LightMyRequestResponse> =>
  server.inject({
    method: 'PATCH',
    url: `/api/admin/events/${eventId}/attendance/${accountId}/payment`,
    headers: { cookie },
    payload,
  })

const names = (response: LightMyRequestResponse) =>
  response
    .json()
    .entries.map((entry: { name: string; waiting: boolean }) =>
      entry.waiting ? `${entry.name} (waiting)` : entry.name,
    )

describe('the list of who is coming', () => {
  it('joins in the person details rather than duplicating them', async () => {
    // Corrected on someone's own profile page, corrected here — which is the
    // reason those fields live on the account.
    const server = await build()
    const admin = await givenAccount('Org', ['admin'])
    const eventId = await givenEvent()
    const ana = await givenAccount('Ana')
    await givenComing(eventId, ana.id, '2026-07-01T00:00:00Z')

    const entry = (await roster(server, admin.cookie, eventId)).json().entries[0]

    expect(entry.name).toBe('Ana')
    expect(entry.allergies_notes).toBe('peanuts')
    expect(entry.contact).toBe('Ana on discord')
  })

  it('orders by joining while nobody has paid', async () => {
    const server = await build()
    const admin = await givenAccount('Org', ['admin'])
    const eventId = await givenEvent()
    const first = await givenAccount('First')
    const second = await givenAccount('Second')
    await givenComing(eventId, second.id, '2026-07-02T00:00:00Z')
    await givenComing(eventId, first.id, '2026-07-01T00:00:00Z')

    expect(names(await roster(server, admin.cookie, eventId))).toEqual(['First', 'Second'])
  })

  it('lists whoever has paid above whoever has not', async () => {
    const server = await build()
    const admin = await givenAccount('Org', ['admin'])
    const eventId = await givenEvent()
    const early = await givenAccount('Early')
    const payer = await givenAccount('Payer')
    await givenComing(eventId, early.id, '2026-07-01T00:00:00Z')
    await givenComing(eventId, payer.id, '2026-07-02T00:00:00Z', true)

    expect(names(await roster(server, admin.cookie, eventId))).toEqual(['Payer', 'Early'])
  })

  it('marks everyone past the cap as waiting', async () => {
    const server = await build()
    const admin = await givenAccount('Org', ['admin'])
    const eventId = await givenEvent(2)
    for (const [name, day] of [
      ['First', '01'],
      ['Second', '02'],
      ['Third', '03'],
    ] as const) {
      const who = await givenAccount(name)
      await givenComing(eventId, who.id, `2026-07-${day}T00:00:00Z`)
    }

    expect(names(await roster(server, admin.cookie, eventId))).toEqual(['First', 'Second', 'Third (waiting)'])
  })

  it('re-sorts the moment someone pays, pushing an unpaid member out', async () => {
    // The whole point of the rule, end to end: the third member does nothing but
    // pay, and the second loses their place without acting at all.
    const server = await build()
    const admin = await givenAccount('Org', ['admin'])
    const eventId = await givenEvent(2)
    const first = await givenAccount('First')
    const second = await givenAccount('Second')
    const third = await givenAccount('Third')
    await givenComing(eventId, first.id, '2026-07-01T00:00:00Z')
    await givenComing(eventId, second.id, '2026-07-02T00:00:00Z')
    await givenComing(eventId, third.id, '2026-07-03T00:00:00Z')

    await setPayment(server, admin.cookie, eventId, third.id, {
      payment_status: 'paid',
      payment_date: '2026-07-04',
    })

    expect(names(await roster(server, admin.cookie, eventId))).toEqual(['Third', 'First', 'Second (waiting)'])
  })

  it('reports the cap alongside, so a count means something', async () => {
    const server = await build()
    const admin = await givenAccount('Org', ['admin'])
    const eventId = await givenEvent(7)

    const body = (await roster(server, admin.cookie, eventId)).json()

    expect(body.event.member_cap).toBe(7)
    expect(body.entries).toEqual([])
  })

  it('answers 404 for an event that does not exist', async () => {
    const server = await build()
    const admin = await givenAccount('Org', ['admin'])

    expect((await roster(server, admin.cookie, randomUUID())).statusCode).toBe(404)
  })

  it('refuses a member and an anonymous caller', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenAccount('Member')

    expect((await roster(server, member.cookie, eventId)).statusCode).toBe(403)
    expect(
      (await server.inject({ method: 'GET', url: `/api/admin/events/${eventId}/roster` })).statusCode,
    ).toBe(401)
  })
})

describe('recording a payment', () => {
  it('sets the status and the date', async () => {
    const server = await build()
    const admin = await givenAccount('Org', ['admin'])
    const eventId = await givenEvent()
    const who = await givenAccount('Payer')
    await givenComing(eventId, who.id, '2026-07-01T00:00:00Z')

    const response = await setPayment(server, admin.cookie, eventId, who.id, {
      payment_status: 'paid',
      payment_date: '2026-07-04',
    })

    expect(response.statusCode).toBe(200)
    const [row] = await db().select().from(attendance).where(eq(attendance.account_id, who.id))
    expect(row?.payment_status).toBe('paid')
    expect(row?.payment_date).toBe('2026-07-04')
  })

  it('can undo a payment recorded by mistake', async () => {
    const server = await build()
    const admin = await givenAccount('Org', ['admin'])
    const eventId = await givenEvent()
    const who = await givenAccount('Payer')
    await givenComing(eventId, who.id, '2026-07-01T00:00:00Z', true)

    await setPayment(server, admin.cookie, eventId, who.id, {
      payment_status: 'unpaid',
      payment_date: null,
    })

    const [row] = await db().select().from(attendance).where(eq(attendance.account_id, who.id))
    expect(row?.payment_status).toBe('unpaid')
    expect(row?.payment_date).toBeNull()
  })

  it('refuses a status outside the vocabulary', async () => {
    // `partial` is gone, and this is what keeps it gone.
    const server = await build()
    const admin = await givenAccount('Org', ['admin'])
    const eventId = await givenEvent()
    const who = await givenAccount('Payer')
    await givenComing(eventId, who.id, '2026-07-01T00:00:00Z')

    expect(
      (await setPayment(server, admin.cookie, eventId, who.id, { payment_status: 'partial' })).statusCode,
    ).toBe(400)
  })

  it('refuses anything that is not payment', async () => {
    // An organiser recording a payment has no business rewriting someone's
    // arrival date in the same request.
    const server = await build()
    const admin = await givenAccount('Org', ['admin'])
    const eventId = await givenEvent()
    const who = await givenAccount('Payer')
    await givenComing(eventId, who.id, '2026-07-01T00:00:00Z')

    expect(
      (await setPayment(server, admin.cookie, eventId, who.id, { arrival_date: '2026-08-01' })).statusCode,
    ).toBe(400)
  })

  it('treats an empty body as a read rather than a 500', async () => {
    // `set({})` is not valid SQL, so the branch exists; without a test it is the
    // one path nothing walks.
    const server = await build()
    const admin = await givenAccount('Org', ['admin'])
    const eventId = await givenEvent()
    const who = await givenAccount('Payer')
    await givenComing(eventId, who.id, '2026-07-01T00:00:00Z', true)

    const response = await setPayment(server, admin.cookie, eventId, who.id, {})

    expect(response.statusCode).toBe(200)
    expect(response.json().attendance.payment_status).toBe('paid')
  })

  it('answers 404 for an empty body against someone who is not coming', async () => {
    // The passing sibling's opposite: the read-back path has to distinguish
    // "nothing to change" from "no such row" just as the write path does.
    const server = await build()
    const admin = await givenAccount('Org', ['admin'])
    const eventId = await givenEvent()
    const who = await givenAccount('Absent')

    expect((await setPayment(server, admin.cookie, eventId, who.id, {})).statusCode).toBe(404)
  })

  it('answers 404 for someone who is not coming', async () => {
    const server = await build()
    const admin = await givenAccount('Org', ['admin'])
    const eventId = await givenEvent()
    const who = await givenAccount('Absent')

    expect(
      (await setPayment(server, admin.cookie, eventId, who.id, { payment_status: 'paid' })).statusCode,
    ).toBe(404)
  })

  it('refuses a member and an anonymous caller', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const who = await givenAccount('Member')
    await givenComing(eventId, who.id, '2026-07-01T00:00:00Z')

    expect(
      (await setPayment(server, who.cookie, eventId, who.id, { payment_status: 'paid' })).statusCode,
    ).toBe(403)

    const anonymous = await server.inject({
      method: 'PATCH',
      url: `/api/admin/events/${eventId}/attendance/${who.id}/payment`,
      payload: { payment_status: 'paid' },
    })
    expect(anonymous.statusCode).toBe(401)

    const [row] = await db().select().from(attendance)
    expect(row?.payment_status).toBe('unpaid')
  })

  it('is per (event, account), so two burns have independent payments', async () => {
    const server = await build()
    const admin = await givenAccount('Org', ['admin'])
    const summer = await givenEvent()
    const winter = await givenEvent()
    const who = await givenAccount('Both')
    await givenComing(summer, who.id, '2026-07-01T00:00:00Z')
    await givenComing(winter, who.id, '2026-07-01T00:00:00Z')

    await setPayment(server, admin.cookie, summer, who.id, { payment_status: 'paid' })

    const rows = await db().select().from(attendance).where(eq(attendance.account_id, who.id))
    expect(rows.filter((row) => row.payment_status === 'paid')).toHaveLength(1)
  })
})

describe('what the roster says about helping out', () => {
  const givenStay = async (eventId: string, accountId: string) => {
    const id = randomUUID()
    await db().insert(attendance).values({
      id,
      event_id: eventId,
      account_id: accountId,
      joined_at: '2026-07-01T00:00:00Z',
      payment_status: 'unpaid',
    })
    return id
  }

  it('resolves the labels, since a CSV of UUIDs is no use to anybody', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount('Ada', ['admin'])
    const who = await givenAccount('Grace')
    const stay = await givenStay(eventId, who.id)

    const sauna = randomUUID()
    const kitchen = randomUUID()
    await db()
      .insert(eventOption)
      .values([
        { id: sauna, event_id: eventId, kind: 'helping', order: 0, label: 'Sauna', capacity: null },
        { id: kitchen, event_id: eventId, kind: 'helping', order: 1, label: 'Kitchen', capacity: null },
      ])
    await db()
      .insert(attendanceHelping)
      .values([
        { attendance_id: stay, option_id: kitchen },
        { attendance_id: stay, option_id: sauna },
      ])

    const entry = (await roster(server, admin.cookie, eventId)).json().entries[0]

    // The organiser's order, not the order they happened to be ticked in.
    expect(entry.helping).toBe('Sauna, Kitchen')
    expect([...entry.helping_option_ids].sort()).toEqual([sauna, kitchen].sort())
  })

  it('says nothing rather than an empty string when nobody ticked anything', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount('Ada', ['admin'])
    const who = await givenAccount('Grace')
    await givenStay(eventId, who.id)

    const entry = (await roster(server, admin.cookie, eventId)).json().entries[0]

    expect(entry.helping).toBeNull()
    expect(entry.helping_option_ids).toEqual([])
  })
})
