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
 * Every one of these is **off** unless somebody switches it on, so each test turns
 * the category on first. That is the behaviour, not test scaffolding: an installation
 * where nobody opens the settings sends none of these, which is the point.
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

/** Switch a category on for somebody, which is what makes any of these arrive. */
/**
 * Replaces the whole set, which is what the route takes — so anything a test still
 * wants on has to be named here too.
 */
const switchOn = (server: FastifyInstance, cookie: string, ...categories: string[]) =>
  server.inject({
    method: 'PUT',
    url: '/api/me/notification-settings',
    headers: { cookie },
    payload: { on: categories, email: [] },
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
    ]) {
      client()
        .prepare(
          'insert into notification (id, account_id, category, body, created_at) values (?, ?, ?, ?, ?)',
        )
        .run(randomUUID(), ada.id, category, 'something happened', NOW)
    }

    expect(await bodiesFor(server, ada.cookie)).toHaveLength(5)
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
