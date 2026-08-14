import type { FastifyInstance } from 'fastify'

import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, attendance, event } from '../db/schema.ts'

/**
 * What is going on around you, for whoever asked to hear it (#259).
 *
 * The burn-wide ones are **off** unless somebody switches them on, so each of those
 * tests turns the category on first. That is the behaviour, not test scaffolding: an
 * installation where nobody opens the settings sends none of them, which is the point.
 *
 * The exception is the admin one at the bottom — an application is on for whoever
 * reviews applications, and switching it on is what those tests never do (#326).
 */

const SECRET = 's'.repeat(40)
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
    deliver: () => Promise.resolve('sent'),
    mintKeys: () => ({ publicKey: 'a-public-key', privateKey: 'a-private-key' }),
  })
  return app
}

const cookieFor = (id: string) => {
  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return `${SESSION_COOKIE}=${sessions.issue(id)}`
}

const givenAccount = async (name: string, roles: ('admin' | 'member')[] = ['member']) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, name, password_hash: null, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  return { id, name, cookie: cookieFor(id) }
}

const givenBurn = async (id = BURN, slug = 'summer') => {
  await db().insert(event).values({
    id,
    name: 'Summer burn',
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

/**
 * Switch categories on for somebody, which is what makes any of these arrive.
 *
 * Replaces the whole set, which is what the route takes — so anything a test still
 * wants on has to be named here too.
 */
const switchOn = (server: FastifyInstance, cookie: string, ...categories: string[]) =>
  server.inject({
    method: 'PUT',
    url: '/api/me/notification-settings',
    headers: { cookie },
    payload: { on: categories, email: [], digest: 'daily' },
  })

const bodiesFor = async (server: FastifyInstance, cookie: string): Promise<string[]> => {
  const response = await server.inject({
    method: 'GET',
    url: '/api/me/notifications',
    headers: { cookie },
  })

  return response.json().notifications.map((one: { body: string }) => one.body)
}

const offerDream = (server: FastifyInstance, cookie: string, title: string) =>
  server.inject({
    method: 'POST',
    url: `/api/events/${BURN}/sessions`,
    headers: { cookie },
    payload: { title },
  })

const addRole = (server: FastifyInstance, cookie: string, title: string) =>
  server.inject({
    method: 'POST',
    url: `/api/events/${BURN}/roles`,
    headers: { cookie },
    payload: { title },
  })

describe('somebody offers a dream', () => {
  it('reaches whoever asked to hear about it', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    await givenComing(bea.id)
    await switchOn(server, bea.cookie, 'dream_offered')

    expect((await offerDream(server, ada.cookie, 'Sauna at dawn')).statusCode).toBe(201)

    expect(await bodiesFor(server, bea.cookie)).toEqual(['Ada offered a dream: Sauna at dawn'])
  })

  it('reaches nobody who has not asked', async () => {
    // The whole reason these default off: a burn where every dream pings forty-two
    // people is a channel people learn to ignore.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    await givenComing(bea.id)

    await offerDream(server, ada.cookie, 'Sauna at dawn')

    expect(await bodiesFor(server, bea.cookie)).toEqual([])
  })

  it('never tells the person who offered it', async () => {
    // Being told you did the thing you just did is the fastest way to teach somebody
    // that the bell is noise (#247's rule, and it applies harder here).
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    await switchOn(server, ada.cookie, 'dream_offered')

    await offerDream(server, ada.cookie, 'Sauna at dawn')

    expect(await bodiesFor(server, ada.cookie)).toEqual([])
  })

  it('never tells somebody who is not coming to that burn', async () => {
    // "Only for burns you are attending": attendance is the audience, whatever the
    // switches say.
    const server = await build()
    await givenBurn()
    await givenBurn(OTHER_BURN, 'winter')
    const ada = await givenAccount('Ada')
    const elsewhere = await givenAccount('Cai')
    await givenComing(ada.id)
    await givenComing(elsewhere.id, OTHER_BURN)
    await switchOn(server, elsewhere.cookie, 'dream_offered')

    await offerDream(server, ada.cookie, 'Sauna at dawn')

    expect(await bodiesFor(server, elsewhere.cookie)).toEqual([])
  })
})

describe('somebody says they are coming', () => {
  it('reaches whoever asked, naming them', async () => {
    const server = await build()
    await givenBurn()
    const bea = await givenAccount('Bea')
    const ada = await givenAccount('Ada')
    await givenComing(bea.id)
    await switchOn(server, bea.cookie, 'member_joined')

    const joined = await server.inject({
      method: 'POST',
      url: `/api/events/${BURN}/attendance/me`,
      headers: { cookie: ada.cookie },
    })
    expect(joined.statusCode).toBe(201)

    expect(await bodiesFor(server, bea.cookie)).toEqual(['Ada is coming.'])
  })

  it('says nothing when somebody who is already coming says so again', async () => {
    // A no-op write must not read as a second arrival.
    const server = await build()
    await givenBurn()
    const bea = await givenAccount('Bea')
    const ada = await givenAccount('Ada')
    await givenComing(bea.id)
    await givenComing(ada.id)
    await switchOn(server, bea.cookie, 'member_joined')

    await server.inject({
      method: 'POST',
      url: `/api/events/${BURN}/attendance/me`,
      headers: { cookie: ada.cookie },
    })

    expect(await bodiesFor(server, bea.cookie)).toEqual([])
  })
})

describe('the lead-roles register filling up', () => {
  it('says when a role is added, without a name it does not have', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    await givenComing(bea.id)
    await switchOn(server, bea.cookie, 'lead_role_added')

    expect((await addRole(server, ada.cookie, 'Kitchen')).statusCode).toBe(201)

    expect(await bodiesFor(server, bea.cookie)).toEqual(['A new lead role: Kitchen'])
  })

  it('says who took one', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    const cai = await givenAccount('Cai')
    await givenComing(ada.id)
    await givenComing(bea.id)
    await givenComing(cai.id)
    const role = (await addRole(server, ada.cookie, 'Kitchen')).json().role
    await switchOn(server, bea.cookie, 'lead_role_filled')

    const taken = await server.inject({
      method: 'PUT',
      url: `/api/roles/${role.id}/lead`,
      headers: { cookie: cai.cookie },
      payload: { account_id: cai.id },
    })
    expect(taken.statusCode).toBe(200)

    expect(await bodiesFor(server, bea.cookie)).toEqual(['Cai is now Kitchen lead.'])
  })

  it('does not tell the appointee about themselves twice', async () => {
    // #270. Ada appoints Cai, so Cai gets the personal "You are now Kitchen lead" —
    // and, with the burn-wide category on, used to get "Cai is now Kitchen lead."
    // about themselves as well. Excluded like the actor is.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const cai = await givenAccount('Cai')
    await givenComing(ada.id)
    await givenComing(cai.id)
    const role = (await addRole(server, ada.cookie, 'Kitchen')).json().role
    // Both on: the personal one is what they *should* get, the burn-wide one is what
    // they should not. With only the second, this would pass for the wrong reason.
    await switchOn(server, cai.cookie, 'lead_role', 'lead_role_filled')

    await server.inject({
      method: 'PUT',
      url: `/api/roles/${role.id}/lead`,
      headers: { cookie: ada.cookie },
      payload: { account_id: cai.id },
    })

    expect(await bodiesFor(server, cai.cookie)).toEqual(['You are now Kitchen lead.'])
  })

  it('still tells everybody else, which is what the category is for', async () => {
    // The passing sibling: excluding the appointee must not silence the note.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    const cai = await givenAccount('Cai')
    await givenComing(ada.id)
    await givenComing(bea.id)
    await givenComing(cai.id)
    const role = (await addRole(server, ada.cookie, 'Kitchen')).json().role
    await switchOn(server, bea.cookie, 'lead_role_filled')

    await server.inject({
      method: 'PUT',
      url: `/api/roles/${role.id}/lead`,
      headers: { cookie: ada.cookie },
      payload: { account_id: cai.id },
    })

    expect(await bodiesFor(server, bea.cookie)).toEqual(['Cai is now Kitchen lead.'])
  })

  it('says nothing to the burn when a role falls vacant', async () => {
    // Whoever lost it is told directly, by the personal `lead_role` notification.
    // A vacancy is not news worth pushing to everybody.
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    const cai = await givenAccount('Cai')
    await givenComing(ada.id)
    await givenComing(bea.id)
    await givenComing(cai.id)
    const role = (await addRole(server, ada.cookie, 'Kitchen')).json().role
    await server.inject({
      method: 'PUT',
      url: `/api/roles/${role.id}/lead`,
      headers: { cookie: cai.cookie },
      payload: { account_id: cai.id },
    })
    await switchOn(server, bea.cookie, 'lead_role_filled')

    await server.inject({
      method: 'PUT',
      url: `/api/roles/${role.id}/lead`,
      headers: { cookie: cai.cookie },
      payload: { account_id: null },
    })

    expect(await bodiesFor(server, bea.cookie)).toEqual([])
  })
})

describe('somebody applies to join', () => {
  /**
   * The one notification that goes to admins rather than to a burn's attendees.
   *
   * On by default and switched on by nobody in these tests, which is the behaviour:
   * an application stays open until somebody reviews it, so a push missed on a lock
   * screen costs the applicant the wait. It pushed and wrote no row at all until
   * #326 — an admin found an empty bell after being told.
   */
  const apply = async (server: FastifyInstance) => {
    const wren = await givenAccount('Wren', [])

    return await server.inject({
      method: 'POST',
      url: '/api/applications',
      headers: { cookie: wren.cookie },
      payload: { applicant_name: 'Wren', applicant_email: 'wren@example.org', answers: {}, asked: [] },
    })
  }

  it('fills every admin bell, without being asked for', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])
    const bea = await givenAccount('Bea', ['admin'])

    expect((await apply(server)).statusCode).toBe(201)

    expect(await bodiesFor(server, ada.cookie)).toEqual(['Someone has applied to join.'])
    expect(await bodiesFor(server, bea.cookie)).toEqual(['Someone has applied to join.'])
  })

  it('lands on the page the review happens on', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])

    await apply(server)

    const response = await server.inject({
      method: 'GET',
      url: '/api/me/notifications',
      headers: { cookie: ada.cookie },
    })
    expect(response.json().notifications[0].link).toBe('/admin/applications')
  })

  it('says nothing about who applied', async () => {
    // A notification is read on a lock screen, and the applicant's name is theirs
    // until an admin opens the page. The bell row is a copy of the push, so the same
    // holds of it.
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])

    await apply(server)

    const bodies = await bodiesFor(server, ada.cookie)
    expect(bodies).toHaveLength(1)
    expect(bodies.join()).not.toContain('Wren')
  })

  it('reaches no member, who is offered no switch for it either', async () => {
    const server = await build()
    const bea = await givenAccount('Bea')

    await apply(server)

    expect(await bodiesFor(server, bea.cookie)).toEqual([])
  })

  it('stops for an admin who switches it off', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])
    // Replaces the whole set, so naming nothing switches every category off.
    await switchOn(server, ada.cookie)

    await apply(server)

    expect(await bodiesFor(server, ada.cookie)).toEqual([])
  })

  it('tells an admin who also holds member exactly once', async () => {
    // A cheap guard on the fan-out's shape: `(account_id, role)` is the primary key
    // and the query filters on the role, so a duplicate is not expressible today.
    const server = await build()
    const ada = await givenAccount('Ada', ['admin', 'member'])

    await apply(server)

    expect(await bodiesFor(server, ada.cookie)).toHaveLength(1)
  })
})

describe('the vocabulary the database will accept', () => {
  it('takes the categories #259 added', async () => {
    // The rebuilt CHECK, proved by a write that skips the API. Without the rebuild
    // this throws and every notification above would fail at the insert — so this is
    // also what says the migration ran rather than the schema being read at runtime.
    const server = await build()
    const ada = await givenAccount('Ada')

    for (const category of [
      'dream_offered',
      'member_joined',
      'lead_role_added',
      'lead_role_filled',
      'new_version',
      // #326's, and the reason the tables were rebuilt a second time.
      'application',
    ]) {
      client()
        .prepare(
          'insert into notification (id, account_id, category, body, created_at) values (?, ?, ?, ?, ?)',
        )
        .run(randomUUID(), ada.id, category, 'something happened', NOW)
    }

    expect(await bodiesFor(server, ada.cookie)).toHaveLength(6)
  })

  it('refuses one it has never heard of', async () => {
    await build()
    const ada = await givenAccount('Ada')

    expect(() =>
      client()
        .prepare(
          'insert into notification (id, account_id, category, body, created_at) values (?, ?, ?, ?, ?)',
        )
        .run(randomUUID(), ada.id, 'gossip', 'something happened', NOW),
    ).toThrow()
  })

  it('refuses an unknown category in the settings table too', async () => {
    await build()
    const ada = await givenAccount('Ada')

    expect(() =>
      client()
        .prepare('insert into notification_setting (account_id, category, enabled) values (?, ?, ?)')
        .run(ada.id, 'gossip', 1),
    ).toThrow()
  })
})
