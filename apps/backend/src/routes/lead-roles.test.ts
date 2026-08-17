import type { Thread } from '@sage-burner/shared'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'

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
import {
  account,
  accountRole,
  attendance,
  event,
  leadRole,
  leadRoleMember,
  pushSubscription,
} from '../db/schema.ts'
import { sendGuarded } from '../if-match.testing.ts'

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

const db = () => {
  const found = handle?.db
  if (found === undefined) throw new Error('build() first')
  return found
}

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

const messagesFrom = (deliver: ReturnType<typeof vi.fn<Delivery>>) =>
  deliver.mock.calls.map((call) => {
    const parsed: unknown = JSON.parse(String(call[1]))
    return typeof parsed === 'object' && parsed !== null && 'body' in parsed ? String(parsed.body) : ''
  })

const givenEvent = async (name = 'Summer burn', start = '2026-08-01') => {
  const id = randomUUID()
  await db()
    .insert(event)
    .values({
      id,
      name,
      slug: `burn-${id.slice(0, 8)}`,
      start_date: start,
      end_date: start,
      member_cap: 42,
      created_at: NOW,
    })
  return id
}

const givenAccount = async (roles: ('admin' | 'member')[], name: string | null = 'Ada') => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, name, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return { id, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
}

const givenComing = async (eventId: string, accountId: string) => {
  const id = randomUUID()
  await db()
    .insert(attendance)
    .values({ id, event_id: eventId, account_id: accountId, joined_at: NOW, payment_status: 'unpaid' })
  return id
}

const list = (server: FastifyInstance, cookie: string | undefined, eventId: string) =>
  server.inject({
    method: 'GET',
    url: `/api/events/${eventId}/roles`,
    headers: cookie === undefined ? {} : { cookie },
  })

const add = (
  server: FastifyInstance,
  cookie: string | undefined,
  eventId: string,
  payload: Record<string, unknown> = { title: 'Sauna' },
): Promise<LightMyRequestResponse> =>
  server.inject({
    method: 'POST',
    url: `/api/events/${eventId}/roles`,
    headers: cookie === undefined ? {} : { cookie },
    payload,
  })

const edit = (server: FastifyInstance, cookie: string, id: string, payload: Record<string, unknown>) =>
  sendGuarded((extra) =>
    server.inject({ method: 'PATCH', url: `/api/roles/${id}`, headers: { cookie, ...extra }, payload }),
  )

const remove = (server: FastifyInstance, cookie: string | undefined, id: string) =>
  server.inject({
    method: 'DELETE',
    url: `/api/roles/${id}`,
    headers: cookie === undefined ? {} : { cookie },
  })

const setLead = (server: FastifyInstance, cookie: string, id: string, payload: Record<string, unknown>) =>
  server.inject({ method: 'PUT', url: `/api/roles/${id}/lead`, headers: { cookie }, payload })

const joinTeam = (server: FastifyInstance, cookie: string, id: string, accountId: string) =>
  server.inject({
    method: 'POST',
    url: `/api/roles/${id}/team`,
    headers: { cookie },
    payload: { account_id: accountId },
  })

const leaveTeam = (server: FastifyInstance, cookie: string, id: string, accountId: string) =>
  server.inject({ method: 'DELETE', url: `/api/roles/${id}/team/${accountId}`, headers: { cookie } })

const sources = (server: FastifyInstance, cookie: string | undefined, eventId: string) =>
  server.inject({
    method: 'GET',
    url: `/api/events/${eventId}/roles/sources`,
    headers: cookie === undefined ? {} : { cookie },
  })

const copyFrom = (server: FastifyInstance, cookie: string, eventId: string, fromEventId: string) =>
  server.inject({
    method: 'POST',
    url: `/api/events/${eventId}/roles/copy`,
    headers: { cookie },
    payload: { from_event_id: fromEventId },
  })

describe('who may change the register', () => {
  it('lets any approved member add, edit and remove a role', async () => {
    const server = await build()
    const eventId = await givenEvent()

    for (const roles of [['member'], ['admin'], ['member', 'admin']] as const) {
      const { cookie } = await givenAccount([...roles])
      const added = await add(server, cookie, eventId, { title: `By ${roles.join('+')}` })

      expect(added.statusCode, roles.join('+')).toBe(201)
      const id = added.json().role.id
      expect((await edit(server, cookie, id, { title: 'Renamed' })).statusCode).toBe(200)
      expect((await remove(server, cookie, id)).statusCode).toBe(204)
    }
  })

  it('lets a member remove a role somebody else staffed', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const owner = await givenAccount(['member'], 'Owner')
    const helper = await givenAccount(['member'], 'Helper')
    const other = await givenAccount(['member'], 'Other')
    await givenComing(eventId, owner.id)
    await givenComing(eventId, helper.id)

    const id = (await add(server, owner.cookie, eventId)).json().role.id
    await setLead(server, owner.cookie, id, { account_id: owner.id })
    await joinTeam(server, owner.cookie, id, helper.id)

    expect((await remove(server, other.cookie, id)).statusCode).toBe(204)
    expect(await db().select().from(leadRoleMember)).toEqual([])
  })

  it('refuses a stranger and an account with no roles, for reads as well as writes', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const roleless = await givenAccount([])

    expect((await list(server, undefined, eventId)).statusCode).toBe(401)
    expect((await list(server, roleless.cookie, eventId)).statusCode).toBe(403)
    expect((await add(server, undefined, eventId)).statusCode).toBe(401)
    expect((await add(server, roleless.cookie, eventId)).statusCode).toBe(403)
    expect(await db().select().from(leadRole)).toEqual([])
  })
})

describe('a role', () => {
  it('starts vacant, with no team and no effort claimed', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const { cookie } = await givenAccount(['member'])

    const role = (await add(server, cookie, eventId, { title: 'Sauna' })).json().role

    expect(role).toMatchObject({
      title: 'Sauna',
      purpose: '',
      tasks: '',
      effort_before: 'none',
      effort_during: 'none',
      effort_after: 'none',
      team_size_wanted: 0,
      lead: null,
      team: [],
    })
  })

  it('carries no attendance id, on the list or on the one just added', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenAccount(['member'])
    await givenComing(eventId, member.id)

    const added = await add(server, member.cookie, eventId, { title: 'Sauna' })
    expect(added.body).not.toContain('lead_attendance_id')

    const id = added.json().role.id
    await setLead(server, member.cookie, id, { account_id: member.id })

    const listed = await list(server, member.cookie, eventId)
    expect(listed.json().roles[0].lead).not.toBeNull()
    expect(listed.body).not.toContain('lead_attendance_id')
    expect((await edit(server, member.cookie, id, { title: 'Renamed' })).body).not.toContain(
      'lead_attendance_id',
    )
  })

  it('keeps its three effort answers apart', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const { cookie } = await givenAccount(['member'])

    const role = (
      await add(server, cookie, eventId, {
        title: 'Build',
        effort_before: 'high',
        effort_during: 'low',
        effort_after: 'medium',
      })
    ).json().role

    expect(role).toMatchObject({ effort_before: 'high', effort_during: 'low', effort_after: 'medium' })
  })

  it('refuses an effort level outside the vocabulary, and a blank title', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const { cookie } = await givenAccount(['member'])

    expect((await add(server, cookie, eventId, { title: 'x', effort_before: 'enormous' })).statusCode).toBe(
      400,
    )
    expect((await add(server, cookie, eventId, { title: '   ' })).statusCode).toBe(400)
    expect((await add(server, cookie, eventId, { title: 'x', team_size_wanted: -1 })).statusCode).toBe(400)
  })

  it('refuses an unrecognised key rather than dropping it', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const { cookie } = await givenAccount(['member'])

    expect((await add(server, cookie, eventId, { title: 'x', lead_account_id: 'me' })).statusCode).toBe(400)
  })

  it('answers 404 for a burn that does not exist', async () => {
    const server = await build()
    const { cookie } = await givenAccount(['member'])

    expect((await add(server, cookie, randomUUID())).statusCode).toBe(404)
  })

  it('leaves the fields a one-field edit did not name alone', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const { cookie } = await givenAccount(['member'])
    const id = (
      await add(server, cookie, eventId, {
        title: 'Sauna',
        purpose: 'Keep it hot',
        tasks: '- fetch wood',
        effort_before: 'low',
        effort_after: 'medium',
        team_size_wanted: 3,
      })
    ).json().role.id

    const response = await edit(server, cookie, id, { effort_during: 'high' })

    expect(response.json().role).toMatchObject({
      title: 'Sauna',
      purpose: 'Keep it hot',
      tasks: '- fetch wood',
      effort_before: 'low',
      effort_during: 'high',
      effort_after: 'medium',
      team_size_wanted: 3,
    })
  })

  it('treats an empty edit as a read rather than a 500', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const { cookie } = await givenAccount(['member'])
    const id = (await add(server, cookie, eventId, { title: 'Sauna' })).json().role.id

    const response = await edit(server, cookie, id, {})

    expect(response.statusCode).toBe(200)
    expect(response.json().role.title).toBe('Sauna')
  })

  it('answers 404 for editing or removing one that is not there', async () => {
    const server = await build()
    const { cookie } = await givenAccount(['member'])

    expect((await edit(server, cookie, randomUUID(), { title: 'x' })).statusCode).toBe(404)
    expect((await remove(server, cookie, randomUUID())).statusCode).toBe(404)
  })
})

describe('holding a role', () => {
  it('is taken, handed on and vacated through one route', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const first = await givenAccount(['member'], 'First')
    const second = await givenAccount(['member'], 'Second')
    await givenComing(eventId, first.id)
    await givenComing(eventId, second.id)
    const id = (await add(server, first.cookie, eventId)).json().role.id

    expect((await setLead(server, first.cookie, id, { account_id: first.id })).json().role.lead).toEqual({
      account_id: first.id,
      name: 'First',
    })
    expect((await setLead(server, first.cookie, id, { account_id: second.id })).json().role.lead).toEqual({
      account_id: second.id,
      name: 'Second',
    })
    expect((await setLead(server, first.cookie, id, { account_id: null })).json().role.lead).toBeNull()
  })

  it('refuses somebody who is not coming to that burn', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenAccount(['member'])
    const absent = await givenAccount(['member'], 'Absent')
    await givenComing(eventId, member.id)
    const id = (await add(server, member.cookie, eventId)).json().role.id

    expect((await setLead(server, member.cookie, id, { account_id: absent.id })).statusCode).toBe(400)

    const joined = await joinTeam(server, member.cookie, id, absent.id)
    expect(joined.statusCode).toBe(400)
    expect(joined.json().error).toBe('not_attending')
  })

  it('is vacated by withdrawing from the burn, rather than left on a name', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenAccount(['member'])
    const attendanceId = await givenComing(eventId, member.id)
    const id = (await add(server, member.cookie, eventId)).json().role.id
    await setLead(server, member.cookie, id, { account_id: member.id })

    await db().delete(attendance).where(eq(attendance.id, attendanceId))

    const roles = (await list(server, member.cookie, eventId)).json().roles
    expect(roles[0].lead).toBeNull()
    expect(roles[0].title).toBe('Sauna')
  })
})

describe('a role’s team', () => {
  it('takes people on and off, and joining twice changes nothing', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const lead = await givenAccount(['member'], 'Lead')
    const helper = await givenAccount(['member'], 'Helper')
    await givenComing(eventId, lead.id)
    await givenComing(eventId, helper.id)
    const id = (await add(server, lead.cookie, eventId)).json().role.id

    await joinTeam(server, lead.cookie, id, helper.id)
    const twice = await joinTeam(server, lead.cookie, id, helper.id)

    expect(twice.json().role.team).toEqual([{ account_id: helper.id, name: 'Helper' }])
    expect((await leaveTeam(server, lead.cookie, id, helper.id)).statusCode).toBe(204)
    expect((await list(server, lead.cookie, eventId)).json().roles[0].team).toEqual([])
  })

  it('never refuses a volunteer, however many are wanted', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const lead = await givenAccount(['member'], 'Lead')
    await givenComing(eventId, lead.id)
    const id = (await add(server, lead.cookie, eventId, { title: 'Kitchen', team_size_wanted: 0 })).json()
      .role.id

    const extras = await Promise.all(
      ['One', 'Two', 'Three'].map(async (name) => {
        const person = await givenAccount(['member'], name)
        await givenComing(eventId, person.id)
        return person
      }),
    )
    for (const person of extras) {
      expect((await joinTeam(server, lead.cookie, id, person.id)).statusCode).toBe(200)
    }

    const role = (await list(server, lead.cookie, eventId)).json().roles[0]
    expect(role.team_size_wanted).toBe(0)
    expect(role.team).toHaveLength(3)
  })

  it('loses a member who withdraws from the burn', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const lead = await givenAccount(['member'], 'Lead')
    const helper = await givenAccount(['member'], 'Helper')
    await givenComing(eventId, lead.id)
    const helperAttendance = await givenComing(eventId, helper.id)
    const id = (await add(server, lead.cookie, eventId)).json().role.id
    await joinTeam(server, lead.cookie, id, helper.id)

    await db().delete(attendance).where(eq(attendance.id, helperAttendance))

    expect((await list(server, lead.cookie, eventId)).json().roles[0].team).toEqual([])
  })

  it('is quiet about removing somebody who was never on it', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const lead = await givenAccount(['member'], 'Lead')
    await givenComing(eventId, lead.id)
    const id = (await add(server, lead.cookie, eventId)).json().role.id

    expect((await leaveTeam(server, lead.cookie, id, lead.id)).statusCode).toBe(204)
  })
})

describe('seeding a new burn from a previous one', () => {
  it('copies the definitions and none of the people', async () => {
    const server = await build()
    const last = await givenEvent('Last summer')
    const next = await givenEvent('Next summer')
    const member = await givenAccount(['member'])
    await givenComing(last, member.id)
    const id = (
      await add(server, member.cookie, last, {
        title: 'Sauna',
        purpose: 'Keep it hot',
        tasks: '- fetch wood',
        effort_before: 'low',
        effort_during: 'high',
        effort_after: 'medium',
        team_size_wanted: 3,
      })
    ).json().role.id
    await setLead(server, member.cookie, id, { account_id: member.id })

    const copied = await copyFrom(server, member.cookie, next, last)

    expect(copied.statusCode).toBe(201)
    expect(copied.json().roles).toHaveLength(1)
    expect(copied.json().roles[0]).toMatchObject({
      title: 'Sauna',
      purpose: 'Keep it hot',
      tasks: '- fetch wood',
      effort_before: 'low',
      effort_during: 'high',
      effort_after: 'medium',
      team_size_wanted: 3,
      lead: null,
      team: [],
    })
    expect((await list(server, member.cookie, last)).json().roles[0].lead).not.toBeNull()
  })

  it('offers the burns that have a register, newest first, and never this one', async () => {
    const server = await build()
    const older = await givenEvent('Two summers ago', '2024-08-01')
    const newer = await givenEvent('Last summer', '2025-08-01')
    const bare = await givenEvent('A burn nobody wrote roles for', '2025-09-01')
    const next = await givenEvent('Next summer', '2026-08-01')
    const { cookie } = await givenAccount(['member'])
    await add(server, cookie, older, { title: 'Sauna' })
    await add(server, cookie, newer, { title: 'Sauna' })
    await add(server, cookie, newer, { title: 'Kitchen' })
    await add(server, cookie, next, { title: 'Already here' })

    const offered = (await sources(server, cookie, next)).json().sources

    expect(offered).toEqual([
      { event_id: newer, name: 'Last summer', count: 2 },
      { event_id: older, name: 'Two summers ago', count: 1 },
    ])
    expect(offered.map((row: { event_id: string }) => row.event_id)).not.toContain(bare)
  })

  it('offers nothing to a stranger', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const roleless = await givenAccount([])

    expect((await sources(server, undefined, eventId)).statusCode).toBe(401)
    expect((await sources(server, roleless.cookie, eventId)).statusCode).toBe(403)
  })

  it('copies them in the order they were in, not in id order', async () => {
    const server = await build()
    const last = await givenEvent('Last', '2025-08-01')
    const next = await givenEvent('Next', '2026-08-01')
    const { cookie } = await givenAccount(['member'])

    for (const [index, title] of ['Sauna', 'Kitchen', 'Build'].entries()) {
      await db()
        .insert(leadRole)
        .values({
          id: randomUUID(),
          event_id: last,
          title,
          purpose: '',
          tasks: '',
          effort_before: 'none',
          effort_during: 'none',
          effort_after: 'none',
          team_size_wanted: 0,
          lead_attendance_id: null,
          created_at: new Date(Date.parse(NOW) + index).toISOString(),
        })
    }
    expect((await list(server, cookie, last)).json().roles.map((r: { title: string }) => r.title)).toEqual([
      'Sauna',
      'Kitchen',
      'Build',
    ])

    const copied = await copyFrom(server, cookie, next, last)

    expect(copied.json().roles.map((role: { title: string }) => role.title)).toEqual([
      'Sauna',
      'Kitchen',
      'Build',
    ])
    expect((await list(server, cookie, next)).json().roles.map((r: { title: string }) => r.title)).toEqual([
      'Sauna',
      'Kitchen',
      'Build',
    ])
  })

  it('refuses to copy into a register that already has roles', async () => {
    const server = await build()
    const last = await givenEvent('Last')
    const next = await givenEvent('Next')
    const { cookie } = await givenAccount(['member'])
    await add(server, cookie, last, { title: 'Sauna' })
    await add(server, cookie, next, { title: 'Something already here' })

    expect((await copyFrom(server, cookie, next, last)).statusCode).toBe(409)
    expect((await list(server, cookie, next)).json().roles).toHaveLength(1)
  })

  it('refuses copying a burn onto itself', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const { cookie } = await givenAccount(['member'])

    expect((await copyFrom(server, cookie, eventId, eventId)).statusCode).toBe(400)
  })

  it('answers 404 for a burn that does not exist', async () => {
    const server = await build()
    const last = await givenEvent('Last')
    const { cookie } = await givenAccount(['member'])
    await add(server, cookie, last, { title: 'Sauna' })

    expect((await copyFrom(server, cookie, randomUUID(), last)).statusCode).toBe(404)
  })

  it('answers 404 for a burn that does not exist even when the source is empty', async () => {
    const server = await build()
    const last = await givenEvent('Last', '2025-08-01')
    const { cookie } = await givenAccount(['member'])

    expect((await copyFrom(server, cookie, randomUUID(), last)).statusCode).toBe(404)
  })

  it('answers 404 for a source burn that does not exist', async () => {
    const server = await build()
    const next = await givenEvent('Next', '2026-08-01')
    const { cookie } = await givenAccount(['member'])

    expect((await copyFrom(server, cookie, next, randomUUID())).statusCode).toBe(404)
  })

  it('copies nothing from a burn that had nothing, without complaining', async () => {
    const server = await build()
    const last = await givenEvent('Last')
    const next = await givenEvent('Next')
    const { cookie } = await givenAccount(['member'])

    const copied = await copyFrom(server, cookie, next, last)

    expect(copied.statusCode).toBe(201)
    expect(copied.json().roles).toEqual([])
  })
})

describe('the database, for writes that skip the API', () => {
  it('refuses an effort level outside the vocabulary', async () => {
    await build()
    const eventId = await givenEvent()

    expect(() =>
      handle?.client
        .prepare(
          'insert into lead_role (id, event_id, title, purpose, tasks, effort_before, effort_during, effort_after, team_size_wanted, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(randomUUID(), eventId, 'Sauna', '', '', 'enormous', 'none', 'none', 0, NOW),
    ).toThrow()
  })

  it('refuses a negative team size and a blank title', async () => {
    await build()
    const eventId = await givenEvent()

    const insert = (title: string, size: number) =>
      handle?.client
        .prepare(
          'insert into lead_role (id, event_id, title, purpose, tasks, effort_before, effort_during, effort_after, team_size_wanted, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(randomUUID(), eventId, title, '', '', 'none', 'none', 'none', size, NOW)

    expect(() => insert('Sauna', -1)).toThrow()
    expect(() => insert('   ', 0)).toThrow()
    expect(() => insert('Sauna', 0)).not.toThrow()
  })
})

describe('telling somebody a role moved', () => {
  it('tells the person handed a role, and the person it came off', async () => {
    const deliver = vi.fn<Delivery>(() => Promise.resolve('sent'))
    const server = await build(deliver)
    const eventId = await givenEvent()
    const mover = await givenAccount(['member'], 'Org')
    const before = await givenAccount(['member'], 'Bea')
    const after = await givenAccount(['member'], 'Ada')
    await givenComing(eventId, mover.id)
    await givenComing(eventId, before.id)
    await givenComing(eventId, after.id)
    await givenSubscribed(before.id)
    await givenSubscribed(after.id)
    const roleId = (await add(server, mover.cookie, eventId, { title: 'Sauna' })).json().role.id
    await setLead(server, mover.cookie, roleId, { account_id: before.id })
    deliver.mockClear()

    await setLead(server, mover.cookie, roleId, { account_id: after.id })

    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(2))
    expect(messagesFrom(deliver).toSorted()).toEqual([
      'You are no longer Sauna lead.',
      'You are now Sauna lead.',
    ])
  })

  it('sends the page and the category with the wording, not the wording alone', async () => {
    const deliver = vi.fn<Delivery>(() => Promise.resolve('sent'))
    const server = await build(deliver)
    const eventId = await givenEvent()
    const mover = await givenAccount(['member'], 'Org')
    const taker = await givenAccount(['member'], 'Ada')
    await givenComing(eventId, mover.id)
    await givenComing(eventId, taker.id)
    await givenSubscribed(taker.id)
    const roleId = (await add(server, mover.cookie, eventId, { title: 'Sauna' })).json().role.id

    await setLead(server, mover.cookie, roleId, { account_id: taker.id })

    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1))
    expect(JSON.parse(String(deliver.mock.calls[0]?.[1]))).toEqual({
      body: 'You are now Sauna lead.',
      link: `/roles?burn=${eventId}`,
      category: 'lead_role',
    })
  })

  it('says nothing to somebody who did it themselves', async () => {
    const deliver = vi.fn<Delivery>(() => Promise.resolve('sent'))
    const server = await build(deliver)
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'], 'Ada')
    await givenComing(eventId, ada.id)
    await givenSubscribed(ada.id)
    const roleId = (await add(server, ada.cookie, eventId, { title: 'Sauna' })).json().role.id

    await setLead(server, ada.cookie, roleId, { account_id: ada.id })
    await joinTeam(server, ada.cookie, roleId, ada.id)
    await leaveTeam(server, ada.cookie, roleId, ada.id)

    expect(deliver).not.toHaveBeenCalled()
  })

  it('tells somebody added to a team, and somebody taken off one', async () => {
    const deliver = vi.fn<Delivery>(() => Promise.resolve('sent'))
    const server = await build(deliver)
    const eventId = await givenEvent()
    const mover = await givenAccount(['member'], 'Org')
    const ada = await givenAccount(['member'], 'Ada')
    await givenComing(eventId, mover.id)
    await givenComing(eventId, ada.id)
    await givenSubscribed(ada.id)
    const roleId = (await add(server, mover.cookie, eventId, { title: 'Kitchen' })).json().role.id

    await joinTeam(server, mover.cookie, roleId, ada.id)
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1))

    await leaveTeam(server, mover.cookie, roleId, ada.id)
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(2))

    expect(messagesFrom(deliver)).toEqual([
      'You have been added to the Kitchen team.',
      'You have been taken off the Kitchen team.',
    ])
  })

  it('says nothing when a removal removed nobody, since the route is idempotent', async () => {
    const deliver = vi.fn<Delivery>(() => Promise.resolve('sent'))
    const server = await build(deliver)
    const eventId = await givenEvent()
    const mover = await givenAccount(['member'], 'Org')
    const ada = await givenAccount(['member'], 'Ada')
    await givenComing(eventId, mover.id)
    await givenComing(eventId, ada.id)
    await givenSubscribed(ada.id)
    const roleId = (await add(server, mover.cookie, eventId, { title: 'Kitchen' })).json().role.id

    expect((await leaveTeam(server, mover.cookie, roleId, ada.id)).statusCode).toBe(204)
    expect(deliver).not.toHaveBeenCalled()
  })

  it('says nothing to somebody who never opted in', async () => {
    const deliver = vi.fn<Delivery>(() => Promise.resolve('sent'))
    const server = await build(deliver)
    const eventId = await givenEvent()
    const mover = await givenAccount(['member'], 'Org')
    const ada = await givenAccount(['member'], 'Ada')
    await givenComing(eventId, mover.id)
    await givenComing(eventId, ada.id)
    const roleId = (await add(server, mover.cookie, eventId, { title: 'Kitchen' })).json().role.id

    expect((await joinTeam(server, mover.cookie, roleId, ada.id)).statusCode).toBe(200)
    expect(deliver).not.toHaveBeenCalled()
  })

  it('hands the role over even when the push service is down', async () => {
    const deliver = vi.fn<Delivery>(() => Promise.reject(new Error('push is down')))
    const server = await build(deliver)
    const eventId = await givenEvent()
    const mover = await givenAccount(['member'], 'Org')
    const ada = await givenAccount(['member'], 'Ada')
    await givenComing(eventId, mover.id)
    await givenComing(eventId, ada.id)
    await givenSubscribed(ada.id)
    const roleId = (await add(server, mover.cookie, eventId, { title: 'Kitchen' })).json().role.id

    const response = await setLead(server, mover.cookie, roleId, { account_id: ada.id })

    expect(response.statusCode).toBe(200)
    expect(response.json().role.lead?.account_id).toBe(ada.id)
  })
})

describe('a burn that has ended', () => {
  const setUp = async () => {
    const server = await build()
    const over = await givenEvent('Last summer', '2026-06-01')
    const ada = await givenAccount(['member'], 'Ada')
    await givenComing(over, ada.id)
    const id = (await add(server, ada.cookie, over)).json().role.id

    return { server, over, ada, id }
  }

  it('still lets the register be added to — only the bare-id writes are scoped', async () => {
    const { server, over, ada } = await setUp()

    expect((await add(server, ada.cookie, over, { title: 'Another' })).statusCode).toBe(201)
  })

  it('refuses every write keyed by the role itself', async () => {
    const { server, ada, id } = await setUp()

    expect((await edit(server, ada.cookie, id, { title: 'Renamed' })).statusCode).toBe(404)
    expect((await setLead(server, ada.cookie, id, { account_id: ada.id })).statusCode).toBe(404)
    expect((await joinTeam(server, ada.cookie, id, ada.id)).statusCode).toBe(404)
    expect((await leaveTeam(server, ada.cookie, id, ada.id)).statusCode).toBe(404)
    expect((await remove(server, ada.cookie, id)).statusCode).toBe(404)
  })

  it('leaves the record alone when a write is refused', async () => {
    const { server, ada, id } = await setUp()

    await edit(server, ada.cookie, id, { title: 'Renamed' })
    await remove(server, ada.cookie, id)

    const [row] = await db().select().from(leadRole).where(eq(leadRole.id, id))
    expect(row?.title).not.toBe('Renamed')
  })

  it('takes every one of them on a burn that has not ended', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'], 'Ada')
    await givenComing(eventId, ada.id)
    const id = (await add(server, ada.cookie, eventId)).json().role.id

    expect((await edit(server, ada.cookie, id, { title: 'Renamed' })).statusCode).toBe(200)
    expect((await setLead(server, ada.cookie, id, { account_id: ada.id })).statusCode).toBe(200)
    expect((await joinTeam(server, ada.cookie, id, ada.id)).statusCode).toBe(200)
    expect((await leaveTeam(server, ada.cookie, id, ada.id)).statusCode).toBe(204)
    expect((await remove(server, ada.cookie, id)).statusCode).toBe(204)
  })
})

describe('rewriting a role somebody else has just rewritten', () => {
  const rename = (server: FastifyInstance, cookie: string, id: string, version?: string) =>
    server.inject({
      method: 'PATCH',
      url: `/api/roles/${id}`,
      headers: { cookie, ...(version === undefined ? {} : { 'if-match': version }) },
      payload: { title: 'Sauna keeper' },
    })

  it('refuses one written against no version of the register, and against an old one', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const bea = await givenAccount(['member'], 'Bea')
    const mine = (await add(server, ada.cookie, eventId)).json().role.id
    const theirs = (await add(server, bea.cookie, eventId, { title: 'Gate' })).json().role.id

    const asAdaSawIt = String((await list(server, ada.cookie, eventId)).headers.etag)

    expect((await rename(server, ada.cookie, mine)).statusCode).toBe(428)

    expect((await edit(server, bea.cookie, theirs, { title: 'Welcome gate' })).statusCode).toBe(200)

    const refused = await rename(server, ada.cookie, mine, asAdaSawIt)
    expect(refused.statusCode).toBe(412)
    expect(refused.json().roles.map((role: { title: string }) => role.title)).toContain('Welcome gate')
  })

  it('takes one written against the version it was handed', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const mine = (await add(server, ada.cookie, eventId)).json().role.id

    const current = String((await list(server, ada.cookie, eventId)).headers.etag)

    expect((await rename(server, ada.cookie, mine, current)).statusCode).toBe(200)
  })
})

describe('the card a role carries', () => {
  const cardFor = async (server: FastifyInstance, cookie: string, roleId: string) => {
    const feed = await server.inject({ method: 'GET', url: '/api/feed', headers: { cookie } })
    const found = (feed.json().threads as Thread[]).find((card) => card.entity_id === roleId)
    if (found === undefined) throw new Error(`no card for ${roleId}`)

    return found
  }

  const entriesOn = async (server: FastifyInstance, cookie: string, roleId: string) => {
    const card = await cardFor(server, cookie, roleId)
    const answered = await server.inject({
      method: 'GET',
      url: `/api/threads/${card.id}`,
      headers: { cookie },
    })

    return (answered.json().thread.entries as Thread['entries']).map((entry) => [
      entry.author?.name ?? null,
      entry.kind,
      entry.body,
    ])
  }

  const say = (server: FastifyInstance, cookie: string, threadId: string, body: string) =>
    server.inject({
      method: 'POST',
      url: `/api/threads/${threadId}/comments`,
      headers: { cookie },
      payload: { body },
    })

  const bellFor = async (server: FastifyInstance, cookie: string) =>
    (await server.inject({ method: 'GET', url: '/api/me/notifications', headers: { cookie } })).json()
      .notifications as { body: string; category: string; link: string }[]

  it('opens with who added it, and carries the purpose as the card’s body', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    await givenComing(eventId, ada.id)
    const role = (await add(server, ada.cookie, eventId, { title: 'Sauna', purpose: 'Keep it hot' })).json()
      .role

    const card = await cardFor(server, ada.cookie, role.id)
    expect(card.title).toBe('Sauna')
    expect(card.body).toBe('Keep it hot')
    expect(card.entries.map((entry) => [entry.author?.name, entry.kind, entry.body])).toEqual([
      ['Ada', 'added', 'added this lead role'],
    ])
  })

  it('says which way the leading went, in the words of whoever did it', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const bea = await givenAccount(['member'], 'Bea')
    await givenComing(eventId, ada.id)
    await givenComing(eventId, bea.id)
    const role = (await add(server, ada.cookie, eventId)).json().role

    await setLead(server, ada.cookie, role.id, { account_id: ada.id })
    await setLead(server, ada.cookie, role.id, { account_id: bea.id })
    await setLead(server, bea.cookie, role.id, { account_id: null })

    expect(await entriesOn(server, ada.cookie, role.id)).toEqual([
      ['Ada', 'added', 'added this lead role'],
      ['Ada', 'facilitator', 'is leading it'],
      ['Ada', 'facilitator', 'asked Bea to lead it'],
      ['Bea', 'facilitator', 'stepped back from leading it'],
    ])
  })

  it('says who took it over, and who was taken off it', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const bea = await givenAccount(['member'], 'Bea')
    await givenComing(eventId, ada.id)
    await givenComing(eventId, bea.id)
    const role = (await add(server, ada.cookie, eventId)).json().role
    await setLead(server, ada.cookie, role.id, { account_id: ada.id })

    await setLead(server, bea.cookie, role.id, { account_id: bea.id })
    await setLead(server, ada.cookie, role.id, { account_id: null })

    expect((await entriesOn(server, ada.cookie, role.id)).slice(2)).toEqual([
      ['Bea', 'facilitator', 'took over as lead'],
      ['Ada', 'facilitator', 'took Bea off leading it'],
    ])
  })

  it('says nothing when the lead is set to whoever already holds it', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    await givenComing(eventId, ada.id)
    const role = (await add(server, ada.cookie, eventId)).json().role
    await setLead(server, ada.cookie, role.id, { account_id: ada.id })

    await setLead(server, ada.cookie, role.id, { account_id: ada.id })

    expect(await entriesOn(server, ada.cookie, role.id)).toHaveLength(2)
  })

  it('says who joined the team and who left it, and nothing for a hand already up', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const bea = await givenAccount(['member'], 'Bea')
    await givenComing(eventId, ada.id)
    await givenComing(eventId, bea.id)
    const role = (await add(server, ada.cookie, eventId)).json().role

    await joinTeam(server, ada.cookie, role.id, ada.id)
    await joinTeam(server, ada.cookie, role.id, ada.id)
    await joinTeam(server, ada.cookie, role.id, bea.id)
    await leaveTeam(server, bea.cookie, role.id, bea.id)

    expect((await entriesOn(server, ada.cookie, role.id)).slice(1)).toEqual([
      ['Ada', 'helper', 'joined the team'],
      ['Ada', 'helper', 'asked Bea onto the team'],
      ['Bea', 'helper', 'left the team'],
    ])
  })

  it('opens one for every role seeded from a previous burn, in the register’s order', async () => {
    const server = await build()
    const before = await givenEvent('Spring burn', '2026-07-04')
    const eventId = await givenEvent('Summer burn', '2026-07-05')
    const ada = await givenAccount(['member'])
    await givenComing(eventId, ada.id)
    await add(server, ada.cookie, before, { title: 'Firewood' })
    await add(server, ada.cookie, before, { title: 'Kitchen' })

    expect((await copyFrom(server, ada.cookie, eventId, before)).statusCode).toBe(201)

    const feed = await server.inject({ method: 'GET', url: '/api/feed', headers: { cookie: ada.cookie } })
    const here = (feed.json().threads as Thread[]).filter((card) => card.event_id === eventId)
    const register = (await list(server, ada.cookie, eventId)).json().roles as { title: string }[]
    expect(here.map((card) => card.title)).toEqual(register.map((role) => role.title).toReversed())
    expect(here.flatMap((card) => card.entries.map((entry) => entry.body))).toEqual([
      'added this lead role',
      'added this lead role',
    ])
  })

  it('takes the card off the feed with the role, there being nothing left to talk about', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    await givenComing(eventId, ada.id)
    const role = (await add(server, ada.cookie, eventId)).json().role

    const card = await cardFor(server, ada.cookie, role.id)

    await remove(server, ada.cookie, role.id)

    const feed = await server.inject({ method: 'GET', url: '/api/feed', headers: { cookie: ada.cookie } })
    expect(feed.json().threads).toEqual([])
    const answered = await server.inject({
      method: 'GET',
      url: `/api/threads/${card.id}`,
      headers: { cookie: ada.cookie },
    })
    expect(answered.statusCode).toBe(404)
  })

  it('tells the lead and the team when somebody says something about it', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const bea = await givenAccount(['member'], 'Bea')
    const cai = await givenAccount(['member'], 'Cai')
    await givenComing(eventId, ada.id)
    await givenComing(eventId, bea.id)
    await givenComing(eventId, cai.id)
    const role = (await add(server, cai.cookie, eventId)).json().role
    await setLead(server, cai.cookie, role.id, { account_id: ada.id })
    await joinTeam(server, cai.cookie, role.id, bea.id)
    const card = await cardFor(server, ada.cookie, role.id)

    expect((await say(server, cai.cookie, card.id, 'when does it need lighting?')).statusCode).toBe(200)

    for (const listener of [ada, bea]) {
      expect(await bellFor(server, listener.cookie)).toContainEqual(
        expect.objectContaining({
          category: 'lead_role_comment',
          body: 'Cai said something about Sauna',
          link: `/roles?burn=${eventId}`,
        }),
      )
    }
  })

  it('reaches whoever asked about any role, on its own switch', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const bea = await givenAccount(['member'], 'Bea')
    await givenComing(eventId, ada.id)
    await givenComing(eventId, bea.id)
    const role = (await add(server, ada.cookie, eventId)).json().role
    const card = await cardFor(server, ada.cookie, role.id)
    await server.inject({
      method: 'PUT',
      url: '/api/me/notification-settings',
      headers: { cookie: bea.cookie },
      payload: { on: ['lead_role_comment_any'], email: [], digest: 'off' },
    })

    await say(server, ada.cookie, card.id, 'when does it need lighting?')

    expect((await bellFor(server, bea.cookie)).map((one) => one.category)).toEqual(['lead_role_comment_any'])
  })
})
