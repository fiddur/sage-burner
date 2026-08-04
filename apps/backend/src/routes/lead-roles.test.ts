import type { FastifyInstance, LightMyRequestResponse } from 'fastify'

import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, attendance, event, leadRole, leadRoleMember } from '../db/schema.ts'
import { SESSION_COOKIE } from './auth.ts'

/**
 * The lead-roles register — the spreadsheet's roles tab.
 *
 * The properties worth proving are the ones that diverge from everything else here:
 * **any approved member** may add, edit and remove a role, including one somebody
 * else staffed; the team size is advisory rather than a cap; and a role can only be
 * held by somebody actually coming to that burn, which is why the lead and the team
 * are `attendance` references rather than `account` ones.
 */

const SECRET = 's'.repeat(40)
const NOW = '2026-08-04T00:00:00.000Z'

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
  server.inject({ method: 'PATCH', url: `/api/roles/${id}`, headers: { cookie }, payload })

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
    // The divergence: everywhere else, structural editing is admin-only. These are
    // co-created events replacing a spreadsheet everyone could edit.
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
    // Deliberate, and the sharpest edge of the decision: there is no undo, and the
    // team's sign-ups go with it.
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
    // The sign-ups go with the role rather than outliving it as rows pointing nowhere.
    expect(await db().select().from(leadRoleMember)).toEqual([])
  })

  it('refuses a stranger and an account with no roles, for reads as well as writes', async () => {
    // The register names members, so unlike the schedule it is not public.
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

  it('keeps its three effort answers apart', async () => {
    // Three independent questions: a role can be all planning and no presence.
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
    // The web form deliberately sends only what changed, so this is the ordinary
    // request. Built from the create schema, the update schema reinstated every
    // default — changing one effort level wiped the purpose, the tasks and the
    // wanted team size, and no test noticed because they asserted on the title.
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
    // The register is per burn, and so is holding something in it. 400 rather than
    // 404: the account exists, it is the pairing that is wrong.
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenAccount(['member'])
    const absent = await givenAccount(['member'], 'Absent')
    await givenComing(eventId, member.id)
    const id = (await add(server, member.cookie, eventId)).json().role.id

    expect((await setLead(server, member.cookie, id, { account_id: absent.id })).statusCode).toBe(400)
    expect((await joinTeam(server, member.cookie, id, absent.id)).statusCode).toBe(400)
  })

  it('is vacated by withdrawing from the burn, rather than left on a name', async () => {
    // The lead is an `attendance`, so this is the database's answer rather than a
    // cleanup somebody has to remember.
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
    // `team_size_wanted` is advisory. Unlike a lodging option, which is disabled when
    // full — a bed is finite and a pair of hands is not.
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
    // Who led the sauna last summer is a fact about last summer.
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
    // And the source is untouched, still led.
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
      { event_id: newer, name: 'Last summer', roles: 2 },
      { event_id: older, name: 'Two summers ago', roles: 1 },
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

  it('refuses to copy into a register that already has roles', async () => {
    // Merging two registers is a decision nobody asked for. "Copy into empty" is the
    // case that removes the retyping.
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
    // The CHECK exists for exactly the writes the Zod schema never sees.
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
