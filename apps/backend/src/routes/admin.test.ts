import type { FastifyInstance } from 'fastify'

import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole } from '../db/schema.ts'
import { SESSION_COOKIE } from './auth.ts'

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

const givenAccount = async (roles: ('admin' | 'member')[]) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return { id, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
}

const setRoles = (
  server: FastifyInstance,
  cookie: string | undefined,
  accountId: string,
  payload: Record<string, unknown>,
) =>
  server.inject({
    method: 'PUT',
    url: `/api/admin/accounts/${accountId}/roles`,
    headers: cookie === undefined ? {} : { cookie },
    payload,
  })

const rolesOf = async (accountId: string) =>
  (await db().select().from(accountRole).where(eq(accountRole.account_id, accountId)))
    .map((row) => row.role)
    .sort()

describe('an organiser editing who holds which role', () => {
  it('grants a role an account did not have', async () => {
    // An account holding `admin` alone — granted here rather than bootstrapped,
    // since `admin:create` gives both — cannot reach its own profile or say it is
    // coming until `member` is added.
    const server = await build()
    const admin = await givenAccount(['admin'])

    const response = await setRoles(server, admin.cookie, admin.id, { roles: ['admin', 'member'] })

    expect(response.statusCode).toBe(200)
    expect(response.json().account.roles.sort()).toEqual(['admin', 'member'])
    expect(await rolesOf(admin.id)).toEqual(['admin', 'member'])
  })

  it('opens the member routes to them, which is the point of doing it', async () => {
    // Hiding the nav link was never what stopped them: `/api/me/profile` is
    // behind `requireMember` and answered 403 to an organiser without the role.
    const server = await build()
    const admin = await givenAccount(['admin'])
    const profile = () =>
      server.inject({ method: 'GET', url: '/api/me/profile', headers: { cookie: admin.cookie } })

    expect((await profile()).statusCode).toBe(403)

    await setRoles(server, admin.cookie, admin.id, { roles: ['admin', 'member'] })

    expect((await profile()).statusCode).toBe(200)
  })

  it('takes a role away', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const someone = await givenAccount(['member'])

    const response = await setRoles(server, admin.cookie, someone.id, { roles: [] })

    expect(response.statusCode).toBe(200)
    expect(await rolesOf(someone.id)).toEqual([])
  })

  it('replaces the whole set rather than adding to it', async () => {
    // Declarative on purpose: the editor sends what the row now says, so it
    // cannot express "add admin, forget to remove member".
    const server = await build()
    const admin = await givenAccount(['admin'])
    const someone = await givenAccount(['admin', 'member'])

    await setRoles(server, admin.cookie, someone.id, { roles: ['member'] })

    expect(await rolesOf(someone.id)).toEqual(['member'])
  })

  it('is idempotent, so a double click is not an error', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const someone = await givenAccount(['member'])

    expect((await setRoles(server, admin.cookie, someone.id, { roles: ['member'] })).statusCode).toBe(200)
    expect((await setRoles(server, admin.cookie, someone.id, { roles: ['member'] })).statusCode).toBe(200)
    expect(await rolesOf(someone.id)).toEqual(['member'])
  })

  it('refuses to remove the last organiser, which would lock everyone out', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])

    const response = await setRoles(server, admin.cookie, admin.id, { roles: ['member'] })

    expect(response.statusCode).toBe(409)
    expect(await rolesOf(admin.id)).toEqual(['admin'])
  })

  it('lets an organiser step down once there is another', async () => {
    // The passing sibling: the guard must refuse the last one, not every one.
    const server = await build()
    const admin = await givenAccount(['admin'])
    await givenAccount(['admin'])

    const response = await setRoles(server, admin.cookie, admin.id, { roles: ['member'] })

    expect(response.statusCode).toBe(200)
    expect(await rolesOf(admin.id)).toEqual(['member'])
  })

  it('keeps one organiser when two step down at the same moment', async () => {
    // Two organisers stepping down together must still leave one. Removing the
    // last-admin guard fails this as well as the sequential case.
    const server = await build()
    const first = await givenAccount(['admin'])
    const second = await givenAccount(['admin'])

    const [a, b] = await Promise.all([
      setRoles(server, first.cookie, first.id, { roles: [] }),
      setRoles(server, second.cookie, second.id, { roles: [] }),
    ])

    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409])
    const admins = [...(await rolesOf(first.id)), ...(await rolesOf(second.id))]
    expect(admins).toEqual(['admin'])
  })

  it('answers 404 for an account that does not exist', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])

    expect((await setRoles(server, admin.cookie, randomUUID(), { roles: ['member'] })).statusCode).toBe(404)
  })

  it('refuses a role it does not know, a duplicate, and a stray key', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const someone = await givenAccount(['member'])

    expect((await setRoles(server, admin.cookie, someone.id, { roles: ['owner'] })).statusCode).toBe(400)
    expect(
      (await setRoles(server, admin.cookie, someone.id, { roles: ['member', 'member'] })).statusCode,
    ).toBe(400)
    expect(
      (await setRoles(server, admin.cookie, someone.id, { roles: ['member'], name: 'x' })).statusCode,
    ).toBe(400)
    expect(await rolesOf(someone.id)).toEqual(['member'])
  })

  it('refuses anyone who is not an organiser', async () => {
    const server = await build()
    const member = await givenAccount(['member'])
    const someone = await givenAccount([])

    expect((await setRoles(server, undefined, someone.id, { roles: ['admin'] })).statusCode).toBe(401)
    expect((await setRoles(server, member.cookie, someone.id, { roles: ['admin'] })).statusCode).toBe(403)
    expect(await rolesOf(someone.id)).toEqual([])
  })

  it('shows the change on the accounts list', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])

    await setRoles(server, admin.cookie, admin.id, { roles: ['admin', 'member'] })

    const listed = await server.inject({
      method: 'GET',
      url: '/api/admin/accounts',
      headers: { cookie: admin.cookie },
    })
    const found = listed.json().accounts.find((entry: { id: string }) => entry.id === admin.id)

    expect(found.roles.sort()).toEqual(['admin', 'member'])
  })
})
