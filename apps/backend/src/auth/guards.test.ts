import type { FastifyInstance } from 'fastify'

import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole } from '../db/schema.ts'
import { SESSION_COOKIE } from '../routes/auth.ts'
import { createGuards } from './guards.ts'
import { createSessions } from './session.ts'

/**
 * The guards, exercised through a real app rather than a fake request.
 *
 * The thing worth pinning is the difference between "nobody is signed in" and
 * "someone is, but not an admin": 401 sends the browser to the login page, 403
 * must not, and a route that confuses them either loops a signed-in member
 * through login forever or tells an anonymous caller they lack a role.
 */

const SECRET = 's'.repeat(40)

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
  })
  return app
}

const givenAccount = async (roles: ('admin' | 'member')[]) => {
  const db = handle?.db
  if (db === undefined) throw new Error('build() first')

  const id = randomUUID()
  await db.insert(account).values({
    id,
    email: `${id}@example.org`,
    password_hash: null,
    created_at: new Date().toISOString(),
  })
  for (const role of roles) await db.insert(accountRole).values({ account_id: id, role })

  return id
}

/** A cookie for an account, signed the way the app signs its own. */
const cookieFor = (accountId: string) => {
  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return `${SESSION_COOKIE}=${sessions.issue(accountId)}`
}

const getAccounts = (server: FastifyInstance, cookie?: string) =>
  server.inject({
    method: 'GET',
    url: '/api/admin/accounts',
    headers: cookie === undefined ? {} : { cookie },
  })

describe('the admin guard', () => {
  it('answers 401 when nobody is signed in', async () => {
    const server = await build()

    const response = await getAccounts(server)

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'unauthenticated' })
  })

  it('answers 403 for a signed-in member without the role', async () => {
    // Not 401. A member who is signed in and lacks the role must not be sent
    // back through login — they would sign in successfully and bounce again.
    const server = await build()
    const id = await givenAccount(['member'])

    const response = await getAccounts(server, cookieFor(id))

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'forbidden' })
  })

  it('lets an admin through', async () => {
    const server = await build()
    const id = await givenAccount(['admin'])

    const response = await getAccounts(server, cookieFor(id))

    expect(response.statusCode).toBe(200)
  })

  it('answers 401 for a session whose account has been deleted', async () => {
    // The signature proves the token was ours, not that the row still exists.
    const server = await build()

    const response = await getAccounts(server, cookieFor(randomUUID()))

    expect(response.statusCode).toBe(401)
  })

  it('answers 401 for a cookie signed with another secret', async () => {
    const server = await build()
    const id = await givenAccount(['admin'])
    const foreign = createSessions({ secret: 'x'.repeat(40), now: () => new Date(), ttlSeconds: 3600 })

    const response = await getAccounts(server, `${SESSION_COOKIE}=${foreign.issue(id)}`)

    expect(response.statusCode).toBe(401)
  })

  it('does not run the route body when it refuses', async () => {
    // Asserted from inside a handler, because the response cannot show this: a
    // 403 envelope has no `accounts` key whether or not the body ran, so an
    // assertion on the wire passes even if the lifecycle continued and Fastify
    // merely logged FST_ERR_REP_ALREADY_SENT. A counter is observable; the
    // body is not. What this protects is any side effect behind a refusal.
    const server = await build()
    const db = handle?.db
    if (db === undefined) throw new Error('build() first')
    const id = await givenAccount(['member'])

    let ran = 0
    const { requireAdmin } = createGuards({
      db,
      sessions: createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 }),
    })
    server.get('/api/admin/counted', { preHandler: requireAdmin }, async () => {
      ran += 1
      return { ok: true }
    })

    const refused = await server.inject({
      method: 'GET',
      url: '/api/admin/counted',
      headers: { cookie: cookieFor(id) },
    })

    expect(refused.statusCode).toBe(403)
    expect(ran).toBe(0)

    // And the counter is wired up, so `ran === 0` above means "refused" rather
    // than "never reachable".
    const admin = await givenAccount(['admin'])
    await server.inject({ method: 'GET', url: '/api/admin/counted', headers: { cookie: cookieFor(admin) } })
    expect(ran).toBe(1)
  })

  it('marks the roster no-store', async () => {
    // It carries every account's email address. Without this the browser's
    // on-disk cache keeps the whole roster past logout, which clears the cookie
    // and nothing else.
    const server = await build()
    const id = await givenAccount(['admin'])

    const response = await getAccounts(server, cookieFor(id))

    expect(response.headers['cache-control']).toBe('no-store')
  })
})

describe('GET /api/admin/accounts', () => {
  it('lists accounts with their roles', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const member = await givenAccount(['member'])

    const response = await getAccounts(server, cookieFor(admin))

    const { accounts } = response.json()
    expect(accounts).toHaveLength(2)
    expect(accounts.map((row: { id: string }) => row.id).sort()).toEqual([admin, member].sort())

    // Which role landed on which account, not merely that both appear. Grouping
    // on the wrong key — `entry.account_id === row.email` — gives every account
    // `roles: []`, and every other assertion in this file still passes: the
    // guard tests read roles through `viewerFor`'s inline left join, not through
    // this route's
    // grouping. The organiser would see a roster where nobody is an admin.
    const find = (id: string) => accounts.find((row: { id: string }) => row.id === id)
    expect(find(admin)).toMatchObject({ roles: ['admin'] })
    expect(find(member)).toMatchObject({ roles: ['member'] })
  })

  it('never includes the password hash', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])

    const response = await getAccounts(server, cookieFor(admin))

    expect(JSON.stringify(response.json())).not.toContain('password')
  })

  it('gives an account with no roles an empty list rather than dropping it', async () => {
    // Grouping in memory rather than joining is what makes this work; an inner
    // join would silently hide anyone not yet granted a role, which is exactly
    // the account an organiser is looking for.
    const server = await build()
    const admin = await givenAccount(['admin'])
    const roleless = await givenAccount([])

    const response = await getAccounts(server, cookieFor(admin))

    const { accounts } = response.json()
    expect(accounts.find((row: { id: string }) => row.id === roleless)).toMatchObject({ roles: [] })
  })
})
