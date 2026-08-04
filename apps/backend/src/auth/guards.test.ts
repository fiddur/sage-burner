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

describe('an admin route nobody remembered to guard', () => {
  /**
   * The property the prefix hook buys, which per-route `preHandler` could not:
   * a route added later is refused whether or not its author knew to ask.
   *
   * Registered here rather than in `app.ts` precisely because the point is a
   * route the application does not know about. `createApp` does not call
   * `ready`, so the instance still takes routes.
   */
  const withLateRoute = async (path: string) => {
    const server = await build()
    server.get(path, async () => ({ secret: 'the roster' }))
    return server
  }

  it('refuses an unguarded /api/admin route to a signed-out caller', async () => {
    const server = await withLateRoute('/api/admin/late-addition')

    const response = await server.inject({ method: 'GET', url: '/api/admin/late-addition' })

    expect(response.statusCode).toBe(401)
    expect(response.body).not.toContain('the roster')
  })

  it('refuses it to a member without the role', async () => {
    const server = await withLateRoute('/api/admin/late-addition')
    const id = await givenAccount(['member'])

    const response = await server.inject({
      method: 'GET',
      url: '/api/admin/late-addition',
      headers: { cookie: cookieFor(id) },
    })

    expect(response.statusCode).toBe(403)
    expect(response.body).not.toContain('the roster')
  })

  it('lets an admin have it, so the hook gates rather than blocks', async () => {
    // The passing sibling: refusing everything would satisfy the two above.
    const server = await withLateRoute('/api/admin/late-addition')
    const id = await givenAccount(['admin'])

    const response = await server.inject({
      method: 'GET',
      url: '/api/admin/late-addition',
      headers: { cookie: cookieFor(id) },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ secret: 'the roster' })
  })

  it('leaves a route outside the prefix alone', async () => {
    // The other passing sibling: the hook must key on the prefix, not on being
    // installed at all. A public route answering 401 would be a worse bug.
    const server = await withLateRoute('/api/not-admin-at-all')

    const response = await server.inject({ method: 'GET', url: '/api/not-admin-at-all' })

    expect(response.statusCode).toBe(200)
  })

  it('covers the bare prefix, not only paths with a segment after it', async () => {
    // `/api/admin` with nothing after it does not start with `/api/admin/`. No
    // route sits there today; an admin index page is the obvious one to add, and
    // it would have arrived unauthenticated.
    const server = await withLateRoute('/api/admin')

    expect((await server.inject({ method: 'GET', url: '/api/admin' })).statusCode).toBe(401)
  })

  it('is not fooled by a path that merely starts with the letters', async () => {
    // `/api/administrivia` is not under `/api/admin/`, and a `startsWith` on the
    // bare prefix would guard it by accident — harmless here, but the same
    // sloppiness in the other direction is what this hook exists to prevent.
    const server = await withLateRoute('/api/administrivia')

    expect((await server.inject({ method: 'GET', url: '/api/administrivia' })).statusCode).toBe(200)
  })
})

describe('an admin route asked for by a stranger', () => {
  it('refuses before parsing the body, not after', async () => {
    // `onRequest` runs ahead of parsing, where a `preHandler` ran after it. So a
    // caller with no session now gets 401 rather than a parse error describing
    // their own JSON — the body of an unauthorized request is never read.
    const server = await build()

    const response = await server.inject({
      method: 'POST',
      url: '/api/admin/events',
      headers: { 'content-type': 'application/json' },
      payload: '{ this is not json',
    })

    expect(response.statusCode).toBe(401)
  })

  it('still parses for an admin, so the 400 survives where it belongs', async () => {
    const server = await build()
    const id = await givenAccount(['admin'])

    const response = await server.inject({
      method: 'POST',
      url: '/api/admin/events',
      headers: { 'content-type': 'application/json', cookie: cookieFor(id) },
      payload: '{ this is not json',
    })

    expect(response.statusCode).toBe(400)
  })
})

describe('the approved guard', () => {
  // Registered late so the guard is exercised in isolation. Real routes behind
  // `requireApproved` do exist — the places and event-option writes, and
  // `PATCH /api/events/:id/welcome` — and `places.test.ts` and `events.test.ts`
  // assert it through them. What those cannot show is the guard's own answer for a
  // role-less account and a stranger without a route's own 400s and 404s in the
  // way.
  const withApprovedRoute = async () => {
    const server = await build()
    const db = handle?.db
    if (db === undefined) throw new Error('build() first')

    const { requireApproved } = createGuards({
      db,
      sessions: createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 }),
    })
    server.get('/api/open-to-members', { preHandler: requireApproved }, async () => ({ ok: true }))

    return server
  }

  const ask = (server: FastifyInstance, cookie?: string) =>
    server.inject({
      method: 'GET',
      url: '/api/open-to-members',
      headers: cookie === undefined ? {} : { cookie },
    })

  it('lets a member in', async () => {
    const server = await withApprovedRoute()

    expect((await ask(server, cookieFor(await givenAccount(['member'])))).statusCode).toBe(200)
  })

  it('lets an admin in who is not also a member', async () => {
    // The roles are independent, so an account can hold `admin` without `member` —
    // an organiser who is not attending. A `member`-only guard would refuse them.
    const server = await withApprovedRoute()

    expect((await ask(server, cookieFor(await givenAccount(['admin'])))).statusCode).toBe(200)
  })

  it('refuses an account with no roles', async () => {
    // Invited but not yet redeemed, or a role taken away. 403 rather than 401:
    // they are signed in, so sending them back to login would loop.
    const server = await withApprovedRoute()

    const response = await ask(server, cookieFor(await givenAccount([])))

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'forbidden' })
  })

  it('refuses nobody at all with 401', async () => {
    const server = await withApprovedRoute()

    expect((await ask(server)).statusCode).toBe(401)
  })
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
