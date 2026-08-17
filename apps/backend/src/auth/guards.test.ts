import type { FastifyInstance } from 'fastify'

import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole } from '../db/schema.ts'
import { createGuards } from './guards.ts'
import { createSessions } from './session.ts'
import { SESSION_COOKIE } from './viewer.ts'

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
    const server = await withLateRoute('/api/not-admin-at-all')

    const response = await server.inject({ method: 'GET', url: '/api/not-admin-at-all' })

    expect(response.statusCode).toBe(200)
  })

  it('covers the bare prefix, not only paths with a segment after it', async () => {
    const server = await withLateRoute('/api/admin')

    expect((await server.inject({ method: 'GET', url: '/api/admin' })).statusCode).toBe(401)
  })

  it('is not fooled by a path that merely starts with the letters', async () => {
    const server = await withLateRoute('/api/administrivia')

    expect((await server.inject({ method: 'GET', url: '/api/administrivia' })).statusCode).toBe(200)
  })
})

describe('an admin route asked for by a stranger', () => {
  it('refuses before parsing the body, not after', async () => {
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
    const server = await withApprovedRoute()

    expect((await ask(server, cookieFor(await givenAccount(['admin'])))).statusCode).toBe(200)
  })

  it('refuses an account with no roles', async () => {
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

    const admin = await givenAccount(['admin'])
    await server.inject({ method: 'GET', url: '/api/admin/counted', headers: { cookie: cookieFor(admin) } })
    expect(ran).toBe(1)
  })

  it('marks the roster no-store', async () => {
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
    const server = await build()
    const admin = await givenAccount(['admin'])
    const roleless = await givenAccount([])

    const response = await getAccounts(server, cookieFor(admin))

    const { accounts } = response.json()
    expect(accounts.find((row: { id: string }) => row.id === roleless)).toMatchObject({ roles: [] })
  })
})
