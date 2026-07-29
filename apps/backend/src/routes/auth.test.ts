import type { FastifyInstance } from 'fastify'

import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { hashPassword } from '../auth/password.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole } from '../db/schema.ts'
import { SESSION_COOKIE, readSessionCookie } from './auth.ts'

/**
 * The auth routes against a real database and a real session signer.
 *
 * `password.test.ts` and `session.test.ts` cover the primitives in isolation;
 * this covers what a browser actually gets back — statuses, cookie attributes,
 * and which of them differ between environments.
 */

const cheap = { cost: 2 ** 12, blockSize: 8, parallelism: 1 }

let handle: DbHandle | undefined
let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  handle?.close()
  app = undefined
  handle = undefined
})

const build = async (env: NodeJS.ProcessEnv = {}) => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({
      LOG_LEVEL: 'silent',
      SESSION_SECRET: 's'.repeat(40),
      ...env,
    }),
  })
  return app
}

const givenAccount = async (
  server: FastifyInstance,
  { email, password, roles = [] }: { email: string; password?: string; roles?: ('admin' | 'member')[] },
) => {
  const id = randomUUID()
  const db = handle?.db
  if (db === undefined) throw new Error('build() first')

  await db.insert(account).values({
    id,
    email,
    password_hash: password === undefined ? null : await hashPassword(password, cheap),
    created_at: new Date().toISOString(),
  })
  for (const role of roles) await db.insert(accountRole).values({ account_id: id, role })

  return id
}

const login = (server: FastifyInstance, email: string, password: string) =>
  server.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } })

const cookieFrom = (response: { headers: Record<string, unknown> }) => {
  const header = response.headers['set-cookie']
  return typeof header === 'string' ? header : undefined
}

describe('POST /api/auth/login', () => {
  it('signs in a known account and returns its roles', async () => {
    const server = await build()
    await givenAccount(server, {
      email: 'ada@example.org',
      password: 'a good long passphrase',
      roles: ['admin'],
    })

    const response = await login(server, 'ada@example.org', 'a good long passphrase')

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ viewer: { roles: ['admin'] } })
  })

  it('sets an HttpOnly, SameSite=Lax session cookie', async () => {
    const server = await build()
    await givenAccount(server, { email: 'ada@example.org', password: 'a good long passphrase' })

    const cookie = cookieFrom(await login(server, 'ada@example.org', 'a good long passphrase'))

    expect(cookie).toContain(`${SESSION_COOKIE}=`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/')
  })

  it('omits Secure outside production, so plain-HTTP compose still works', async () => {
    // The README promises `docker compose up` is enough to run it. An
    // unconditional Secure flag would make login appear to succeed and then
    // silently drop the cookie.
    const server = await build()
    await givenAccount(server, { email: 'ada@example.org', password: 'a good long passphrase' })

    expect(cookieFrom(await login(server, 'ada@example.org', 'a good long passphrase'))).not.toContain(
      'Secure',
    )
  })

  it('sets Secure in production', async () => {
    const server = await build({ NODE_ENV: 'production', SESSION_SECRET: 'p'.repeat(40) })
    await givenAccount(server, { email: 'ada@example.org', password: 'a good long passphrase' })

    expect(cookieFrom(await login(server, 'ada@example.org', 'a good long passphrase'))).toContain('Secure')
  })

  it('matches the address case-insensitively', async () => {
    // The account table's UNIQUE is BINARY, so a lookup that does not normalise
    // fails to find an account that plainly exists. Typing `Ada@Example.org`
    // into a login form is the ordinary case, not an edge one.
    const server = await build()
    await givenAccount(server, { email: 'ada@example.org', password: 'a good long passphrase' })

    expect((await login(server, '  Ada@Example.ORG  ', 'a good long passphrase')).statusCode).toBe(200)
  })

  it('answers the same way for a wrong password and an unknown address', async () => {
    // Differing here is an account-enumeration oracle: it tells anyone who asks
    // which addresses belong to members, which is the private part of a
    // membership app.
    const server = await build()
    await givenAccount(server, { email: 'ada@example.org', password: 'a good long passphrase' })

    const wrongPassword = await login(server, 'ada@example.org', 'not the passphrase')
    const noSuchAccount = await login(server, 'nobody@example.org', 'a good long passphrase')

    expect(wrongPassword.statusCode).toBe(401)
    expect(noSuchAccount.statusCode).toBe(401)
    expect(wrongPassword.json()).toEqual(noSuchAccount.json())
    expect(wrongPassword.json()).toEqual({ error: 'invalid_credentials' })
  })

  it('answers a malformed body identically too', async () => {
    // Otherwise the *shape* of the error reveals whether an address parses,
    // which is half the oracle back again.
    const server = await build()

    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nope' },
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'invalid_credentials' })
  })

  it('refuses a passkey-only account with no password set', async () => {
    // `password_hash` is null for those. Absent must not read as matching.
    const server = await build()
    await givenAccount(server, { email: 'ada@example.org' })

    expect((await login(server, 'ada@example.org', '')).statusCode).toBe(401)
    expect((await login(server, 'ada@example.org', 'anything')).statusCode).toBe(401)
  })

  it('sets no cookie when the login fails', async () => {
    const server = await build()

    expect(cookieFrom(await login(server, 'nobody@example.org', 'x'))).toBeUndefined()
  })
})

describe('GET /api/auth/me', () => {
  it('answers 200 with a null viewer when nobody is signed in', async () => {
    // Not 401: an anonymous visitor on the public homepage is expected, and the
    // client should not have to treat rendering signed-out as a failure.
    const server = await build()

    const response = await server.inject({ method: 'GET', url: '/api/auth/me' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ viewer: null })
  })

  it('recognises the cookie from a login', async () => {
    const server = await build()
    const id = await givenAccount(server, {
      email: 'ada@example.org',
      password: 'a good long passphrase',
      roles: ['member'],
    })
    const cookie = cookieFrom(await login(server, 'ada@example.org', 'a good long passphrase'))

    const response = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${SESSION_COOKIE}=${readSessionCookie(cookie) ?? ''}` },
    })

    expect(response.json()).toEqual({ viewer: { account_id: id, roles: ['member'] } })
  })

  it('ignores a tampered cookie rather than trusting it', async () => {
    const server = await build()
    await givenAccount(server, { email: 'ada@example.org', password: 'a good long passphrase' })

    const response = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${SESSION_COOKIE}=forged.signature` },
    })

    expect(response.json()).toEqual({ viewer: null })
  })

  it('ignores a valid token whose account has been deleted', async () => {
    // The signature proves the token was ours, not that the row still exists.
    // #35 will delete accounts; this is the path that must not resurrect one.
    const server = await build()
    const id = await givenAccount(server, { email: 'ada@example.org', password: 'a good long passphrase' })
    const cookie = cookieFrom(await login(server, 'ada@example.org', 'a good long passphrase'))
    await handle?.db.delete(account).where(eq(account.id, id))

    const response = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: cookie ?? '' },
    })

    expect(response.json()).toEqual({ viewer: null })
  })
})

describe('caching', () => {
  it('forbids storing any identity response', async () => {
    // These carry per-identity data with no validators, which makes them
    // heuristically cacheable — by the browser's own HTTP cache, which `fetch`
    // uses by default, and by anything in front. The failure that matters is
    // logout: the cookie is gone, but a reload answered from cache still shows
    // the old viewer, and signed sessions give the server no second chance to
    // notice.
    const server = await build()
    await givenAccount(server, { email: 'ada@example.org', password: 'a good long passphrase' })

    const responses = [
      await server.inject({ method: 'GET', url: '/api/auth/me' }),
      await login(server, 'ada@example.org', 'a good long passphrase'),
      await login(server, 'ada@example.org', 'wrong'),
      await server.inject({ method: 'POST', url: '/api/auth/logout' }),
    ]

    for (const response of responses) {
      expect(response.headers['cache-control'], String(response.statusCode)).toBe('no-store')
    }
  })
})

describe('POST /api/auth/logout', () => {
  it('tells the browser to drop the cookie', async () => {
    const server = await build()

    const response = await server.inject({ method: 'POST', url: '/api/auth/logout' })

    expect(response.statusCode).toBe(200)
    expect(cookieFrom(response)).toContain('Max-Age=0')
    expect(response.json()).toEqual({ viewer: null })
  })
})

describe('readSessionCookie', () => {
  it('finds the session among other cookies', () => {
    expect(readSessionCookie(`other=1; ${SESSION_COOKIE}=abc.def; another=2`)).toBe('abc.def')
  })

  it('is undefined when absent, empty, or the header is missing', () => {
    expect(readSessionCookie(undefined)).toBeUndefined()
    expect(readSessionCookie('other=1')).toBeUndefined()
    expect(readSessionCookie(`${SESSION_COOKIE}=`)).toBeUndefined()
  })

  it('does not match a cookie whose name merely ends with ours', () => {
    // `not_sage_session=…` must not be read as the session.
    expect(readSessionCookie(`not_${SESSION_COOKIE}=abc.def`)).toBeUndefined()
  })
})
