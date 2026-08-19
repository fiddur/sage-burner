import type { FastifyInstance } from 'fastify'

import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { hashPassword } from '../auth/password.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import {
  account,
  accountAllergy,
  accountIdentity,
  accountRole,
  allergyItem,
  passkey,
  passwordReset,
} from '../db/schema.ts'
import { digestOf } from '../tokens.ts'

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

const cheap = { cost: 2 ** 12, blockSize: 8, parallelism: 1 }

const build = async () => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: SECRET }),
    now: () => new Date(NOW),
    hash: (password) => hashPassword(password, cheap),
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

describe('an admin editing who holds which role', () => {
  it('grants a role an account did not have', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])

    const response = await setRoles(server, admin.cookie, admin.id, { roles: ['admin', 'member'] })

    expect(response.statusCode).toBe(200)
    expect(response.json().account.roles.sort()).toEqual(['admin', 'member'])
    expect(await rolesOf(admin.id)).toEqual(['admin', 'member'])
  })

  it('opens the member routes to them, which is the point of doing it', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const join = () =>
      server.inject({
        method: 'POST',
        url: `/api/events/${randomUUID()}/attendance/me`,
        headers: { cookie: admin.cookie },
      })

    expect((await join()).statusCode).toBe(403)

    await setRoles(server, admin.cookie, admin.id, { roles: ['admin', 'member'] })

    expect((await join()).statusCode).toBe(404)
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

  it('refuses to remove the last admin, which would lock everyone out', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])

    const response = await setRoles(server, admin.cookie, admin.id, { roles: ['member'] })

    expect(response.statusCode).toBe(409)
    expect(await rolesOf(admin.id)).toEqual(['admin'])
  })

  it('lets an admin step down once there is another', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    await givenAccount(['admin'])

    const response = await setRoles(server, admin.cookie, admin.id, { roles: ['member'] })

    expect(response.statusCode).toBe(200)
    expect(await rolesOf(admin.id)).toEqual(['member'])
  })

  it('keeps one admin when two step down at the same moment', async () => {
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

  it('refuses anyone who is not an admin', async () => {
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

describe('an admin setting somebody’s password', () => {
  const setPassword = (
    server: FastifyInstance,
    cookie: string | undefined,
    accountId: string,
    payload: Record<string, unknown>,
  ) =>
    server.inject({
      method: 'PUT',
      url: `/api/admin/accounts/${accountId}/password`,
      headers: cookie === undefined ? {} : { cookie },
      payload,
    })

  const login = (server: FastifyInstance, email: string, password: string) =>
    server.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } })

  const emailOf = async (accountId: string) =>
    (await db().select().from(account).where(eq(account.id, accountId)))[0]?.email ?? ''

  it('lets them sign in with the new one', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const someone = await givenAccount(['member'])

    const response = await setPassword(server, admin.cookie, someone.id, { password: 'a-new-password' })

    expect(response.statusCode).toBe(204)
    expect((await login(server, await emailOf(someone.id), 'a-new-password')).statusCode).toBe(200)
  })

  it('refuses the old one afterwards', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const someone = await givenAccount(['member'])
    await setPassword(server, admin.cookie, someone.id, { password: 'first-password' })

    await setPassword(server, admin.cookie, someone.id, { password: 'second-password' })

    expect((await login(server, await emailOf(someone.id), 'first-password')).statusCode).toBe(401)
    expect((await login(server, await emailOf(someone.id), 'second-password')).statusCode).toBe(200)
  })

  it('never sends the password back', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const someone = await givenAccount(['member'])

    const response = await setPassword(server, admin.cookie, someone.id, { password: 'a-new-password' })

    expect(response.body).not.toContain('a-new-password')
    expect(response.body).toBe('')
  })

  it('is admin only', async () => {
    const server = await build()
    const member = await givenAccount(['member'])
    const someone = await givenAccount(['member'])

    expect((await setPassword(server, member.cookie, someone.id, { password: 'x' })).statusCode).toBe(403)
    expect((await setPassword(server, undefined, someone.id, { password: 'x' })).statusCode).toBe(401)
  })

  it('answers 404 for an account that does not exist', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])

    const missing = await setPassword(server, admin.cookie, randomUUID(), { password: 'a-long-enough-one' })
    expect(missing.statusCode).toBe(404)
  })

  it('refuses one under the floor, an admin choosing a password getting the same floor (#489)', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const someone = await givenAccount(['member'])

    expect((await setPassword(server, admin.cookie, someone.id, { password: 'short' })).statusCode).toBe(400)
    const long = await setPassword(server, admin.cookie, someone.id, { password: 'a-long-enough-one' })
    expect(long.statusCode).toBe(204)
  })

  it('refuses an empty password, and a body with anything else in it', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const someone = await givenAccount(['member'])

    expect((await setPassword(server, admin.cookie, someone.id, { password: '' })).statusCode).toBe(400)
    expect(
      (await setPassword(server, admin.cookie, someone.id, { password: 'ok', email: 'x@y.z' })).statusCode,
    ).toBe(400)
  })

  it('will set another admin’s, which is the trust the role already carries', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const other = await givenAccount(['admin'])

    expect(
      (await setPassword(server, admin.cookie, other.id, { password: 'a-new-password' })).statusCode,
    ).toBe(204)
  })
})

describe('an admin reading one account', () => {
  const read = (server: FastifyInstance, cookie: string | undefined, accountId: string) =>
    server.inject({
      method: 'GET',
      url: `/api/admin/accounts/${accountId}`,
      headers: cookie === undefined ? {} : { cookie },
    })

  it('answers the person and how they can get in, without the password hash', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const someone = await givenAccount(['member'])
    await db()
      .update(account)
      .set({ name: 'Wren', password_hash: 'hashed' })
      .where(eq(account.id, someone.id))
    await db().insert(accountIdentity).values({
      id: randomUUID(),
      account_id: someone.id,
      provider: 'discord',
      subject: 'discord-1',
      created_at: NOW,
    })
    await db().insert(passkey).values({
      id: randomUUID(),
      account_id: someone.id,
      credential_id: 'cred-1',
      public_key: 'pk',
      label: 'phone',
      created_at: NOW,
    })

    const response = await read(server, admin.cookie, someone.id)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      account: {
        id: someone.id,
        email: `${someone.id}@example.org`,
        name: 'Wren',
        roles: ['member'],
        created_at: NOW,
        has_password: true,
        passkeys: 1,
        identities: ['discord'],
        allergies_notes: null,
        allergy_item_ids: [],
      },
    })
    expect(response.body).not.toContain('hashed')
  })

  it('says when there is no password, which is what an admin setting one wants to know', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const someone = await givenAccount([])

    expect((await read(server, admin.cookie, someone.id)).json().account).toMatchObject({
      has_password: false,
      passkeys: 0,
      identities: [],
      roles: [],
    })
  })

  it('carries the allergies, ticks and notes both', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const someone = await givenAccount(['member'])
    const nuts = randomUUID()
    await db().insert(allergyItem).values({ id: nuts, order: 0, label: 'Nuts' })
    await db().insert(accountAllergy).values({ account_id: someone.id, item_id: nuts })
    await db().update(account).set({ allergies_notes: 'and kiwi' }).where(eq(account.id, someone.id))

    expect((await read(server, admin.cookie, someone.id)).json().account).toMatchObject({
      allergies_notes: 'and kiwi',
      allergy_item_ids: [nuts],
    })
  })

  it('is admin only, and 404 for an account that does not exist', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const member = await givenAccount(['member'])

    expect((await read(server, member.cookie, member.id)).statusCode).toBe(403)
    expect((await read(server, undefined, member.id)).statusCode).toBe(401)
    expect((await read(server, admin.cookie, randomUUID())).statusCode).toBe(404)
  })
})

describe('an admin editing somebody’s details', () => {
  const edit = (
    server: FastifyInstance,
    cookie: string | undefined,
    accountId: string,
    payload: Record<string, unknown>,
  ) =>
    server.inject({
      method: 'PATCH',
      url: `/api/admin/accounts/${accountId}`,
      headers: cookie === undefined ? {} : { cookie },
      payload,
    })

  const rowOf = async (accountId: string) =>
    (await db().select().from(account).where(eq(account.id, accountId)))[0]

  it('writes the name and answers the account as it now is', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const someone = await givenAccount(['member'])

    const response = await edit(server, admin.cookie, someone.id, { name: 'Wren Real' })

    expect(response.statusCode).toBe(200)
    expect(response.json().account).toMatchObject({ id: someone.id, name: 'Wren Real', roles: ['member'] })
    expect((await rowOf(someone.id))?.name).toBe('Wren Real')
  })

  it('changes the login address, folded to lowercase, and they sign in with it', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const someone = await givenAccount(['member'])
    await db()
      .update(account)
      .set({ password_hash: await hashPassword('a-password', cheap) })
      .where(eq(account.id, someone.id))

    const response = await edit(server, admin.cookie, someone.id, { email: '  New.Address@Example.org ' })

    expect(response.statusCode).toBe(200)
    expect(response.json().account.email).toBe('new.address@example.org')
    const login = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'new.address@example.org', password: 'a-password' },
    })
    expect(login.statusCode).toBe(200)
  })

  it('refuses an address another account holds, with 409', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const someone = await givenAccount(['member'])
    const other = await givenAccount(['member'])

    const response = await edit(server, admin.cookie, someone.id, { email: `${other.id}@example.org` })

    expect(response.statusCode).toBe(409)
    expect((await rowOf(someone.id))?.email).toBe(`${someone.id}@example.org`)
  })

  it('drops an outstanding password reset when the address changes, since the link went to the old one', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const someone = await givenAccount(['member'])
    await db()
      .insert(passwordReset)
      .values({
        token_hash: digestOf('a-token'),
        account_id: someone.id,
        expires_at: '2026-07-03T00:00:00.000Z',
        created_at: NOW,
      })

    await edit(server, admin.cookie, someone.id, { name: 'Still Wren' })
    expect(await db().select().from(passwordReset)).toHaveLength(1)

    await edit(server, admin.cookie, someone.id, { email: 'elsewhere@example.org' })
    expect(await db().select().from(passwordReset)).toHaveLength(0)
  })

  it('writes the allergies, ticks and notes, replacing the ticks rather than adding', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const someone = await givenAccount(['member'])
    const nuts = randomUUID()
    const gluten = randomUUID()
    await db()
      .insert(allergyItem)
      .values([
        { id: nuts, order: 0, label: 'Nuts' },
        { id: gluten, order: 1, label: 'Gluten' },
      ])
    await db().insert(accountAllergy).values({ account_id: someone.id, item_id: nuts })

    const response = await edit(server, admin.cookie, someone.id, {
      allergy_item_ids: [gluten],
      allergies_notes: 'kiwi',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().account).toMatchObject({ allergy_item_ids: [gluten], allergies_notes: 'kiwi' })
  })

  it('clears the notes with null, which is how free text becomes a tick', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const someone = await givenAccount(['member'])
    await db().update(account).set({ allergies_notes: 'nuts' }).where(eq(account.id, someone.id))

    const response = await edit(server, admin.cookie, someone.id, { allergies_notes: null })

    expect(response.json().account.allergies_notes).toBeNull()
  })

  it('refuses a tick for an item that does not exist', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const someone = await givenAccount(['member'])

    expect(
      (await edit(server, admin.cookie, someone.id, { allergy_item_ids: [randomUUID()] })).statusCode,
    ).toBe(400)
  })

  it('refuses an empty name, a bad address, and a stray key', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const someone = await givenAccount(['member'])

    expect((await edit(server, admin.cookie, someone.id, { name: '  ' })).statusCode).toBe(400)
    expect((await edit(server, admin.cookie, someone.id, { email: 'not-an-address' })).statusCode).toBe(400)
    expect((await edit(server, admin.cookie, someone.id, { password: 'x' })).statusCode).toBe(400)
    expect((await edit(server, admin.cookie, someone.id, { roles: ['admin'] })).statusCode).toBe(400)
  })

  it('is admin only, and 404 for an account that does not exist', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const member = await givenAccount(['member'])

    expect((await edit(server, member.cookie, member.id, { name: 'Me' })).statusCode).toBe(403)
    expect((await edit(server, undefined, member.id, { name: 'Me' })).statusCode).toBe(401)
    expect((await edit(server, admin.cookie, randomUUID(), { name: 'Me' })).statusCode).toBe(404)
  })

  it('lists the name on the accounts page', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const someone = await givenAccount(['member'])
    await edit(server, admin.cookie, someone.id, { name: 'Wren' })

    const list = await server.inject({
      method: 'GET',
      url: '/api/admin/accounts',
      headers: { cookie: admin.cookie },
    })
    const listed = list.json().accounts.find((row: { id: string }) => row.id === someone.id)

    expect(listed).toMatchObject({ name: 'Wren', email: `${someone.id}@example.org` })
  })
})
