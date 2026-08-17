import type { FastifyInstance } from 'fastify'

import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { AppDeps } from '../app.ts'
import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createGate, SCRYPT_GATE } from '../auth/gate.ts'
import { defaultScryptParams, hashPassword, needsRehash, verifyPassword } from '../auth/password.ts'
import { readSessionCookie, SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountConnection, accountRole } from '../db/schema.ts'

const cheap = { cost: 2 ** 12, blockSize: 8, parallelism: 1 }

let handle: DbHandle | undefined
let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  handle?.close()
  app = undefined
  handle = undefined
})

const build = async (env: NodeJS.ProcessEnv = {}, over: Partial<AppDeps> = {}) => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({
      LOG_LEVEL: 'silent',
      SESSION_SECRET: 's'.repeat(40),
      ...env,
    }),
    ...over,
  })
  return app
}

const breakSelectsAfter = (n: number) => {
  const db = handle?.db
  if (db === undefined) throw new Error('build() first')

  const original = db.select.bind(db)
  let seen = 0
  db.select = ((...args: Parameters<typeof original>) => {
    seen += 1
    if (seen > n) throw new Error('select failed')
    return original(...args)
  }) as typeof db.select
}

const countSelects = () => {
  const db = handle?.db
  if (db === undefined) throw new Error('build() first')

  const original = db.select.bind(db)
  const calls = { count: 0 }
  db.select = ((...args: Parameters<typeof original>) => {
    calls.count += 1
    return original(...args)
  }) as typeof db.select

  return calls
}

const breakUpdates = () => {
  const db = handle?.db
  if (db === undefined) throw new Error('build() first')
  db.update = () => {
    throw new Error('database is locked')
  }
}

const givenAccount = async ({
  email,
  password,
  name = null,
  roles = [],
  params = cheap,
}: {
  email: string
  password?: string
  name?: string | null
  roles?: ('admin' | 'member')[]
  params?: typeof cheap
}) => {
  const id = randomUUID()
  const db = handle?.db
  if (db === undefined) throw new Error('build() first')

  await db.insert(account).values({
    id,
    email,
    name,
    password_hash: password === undefined ? null : await hashPassword(password, params),
    created_at: new Date().toISOString(),
  })
  for (const role of roles) await db.insert(accountRole).values({ account_id: id, role })

  return id
}

const login = (server: FastifyInstance, email: string, password: string) =>
  server.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } })

const retryAfter = (response: { headers: Record<string, unknown> }): number =>
  Number(response.headers['retry-after'])

const cookieFrom = (response: { headers: Record<string, unknown> }) => {
  const header = response.headers['set-cookie']
  return typeof header === 'string' ? header : undefined
}

describe('POST /api/auth/login', () => {
  it('signs in a known account and returns its roles', async () => {
    const server = await build()
    await givenAccount({
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
    await givenAccount({ email: 'ada@example.org', password: 'a good long passphrase' })

    const cookie = cookieFrom(await login(server, 'ada@example.org', 'a good long passphrase'))

    expect(cookie).toContain(`${SESSION_COOKIE}=`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/')
  })

  it('gives the cookie the configured lifetime', async () => {
    const server = await build({ SESSION_TTL_SECONDS: '3600' })
    await givenAccount({ email: 'ada@example.org', password: 'a good long passphrase' })

    const cookie = cookieFrom(await login(server, 'ada@example.org', 'a good long passphrase'))

    expect(cookie).toContain('Max-Age=3600')
  })

  it('omits Secure outside production, which is `pnpm dev` and not compose', async () => {
    const server = await build()
    await givenAccount({ email: 'ada@example.org', password: 'a good long passphrase' })

    expect(cookieFrom(await login(server, 'ada@example.org', 'a good long passphrase'))).not.toContain(
      'Secure',
    )
  })

  it('sets Secure in production', async () => {
    const server = await build({ NODE_ENV: 'production', SESSION_SECRET: 'p'.repeat(40) })
    await givenAccount({ email: 'ada@example.org', password: 'a good long passphrase' })

    expect(cookieFrom(await login(server, 'ada@example.org', 'a good long passphrase'))).toContain('Secure')
  })

  it('matches the address case-insensitively', async () => {
    const server = await build()
    await givenAccount({ email: 'ada@example.org', password: 'a good long passphrase' })

    expect((await login(server, '  Ada@Example.ORG  ', 'a good long passphrase')).statusCode).toBe(200)
  })

  it('answers the same way for a wrong password and an unknown address', async () => {
    const server = await build()
    await givenAccount({ email: 'ada@example.org', password: 'a good long passphrase' })

    const wrongPassword = await login(server, 'ada@example.org', 'not the passphrase')
    const noSuchAccount = await login(server, 'nobody@example.org', 'a good long passphrase')

    expect(wrongPassword.statusCode).toBe(401)
    expect(noSuchAccount.statusCode).toBe(401)
    expect(wrongPassword.json()).toEqual(noSuchAccount.json())
    expect(wrongPassword.json()).toEqual({ error: 'invalid_credentials' })
  })

  it('answers a malformed body identically too', async () => {
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
    const server = await build()
    await givenAccount({ email: 'ada@example.org' })

    expect((await login(server, 'ada@example.org', 'anything')).statusCode).toBe(401)
  })

  it('rejects an empty password before touching the database', async () => {
    const server = await build()
    await givenAccount({ email: 'ada@example.org', password: 'a good long passphrase' })
    const selects = countSelects()

    const response = await login(server, 'ada@example.org', '')

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'invalid_credentials' })
    expect(selects.count).toBe(0)
  })

  it('does read the database for a password that could have been right', async () => {
    const server = await build()
    await givenAccount({ email: 'ada@example.org', password: 'a good long passphrase' })
    const selects = countSelects()

    await login(server, 'ada@example.org', 'wrong but well-formed')

    expect(selects.count).toBeGreaterThan(0)
  })

  it('issues no cookie when the viewer lookup fails', async () => {
    const server = await build()
    await givenAccount({ email: 'ada@example.org', password: 'a good long passphrase' })
    breakSelectsAfter(1)

    const response = await login(server, 'ada@example.org', 'a good long passphrase')

    expect(response.statusCode).toBe(500)
    expect(response.headers['set-cookie']).toBeUndefined()
  })

  it('sets no cookie when the login fails', async () => {
    const server = await build()

    expect(cookieFrom(await login(server, 'nobody@example.org', 'x'))).toBeUndefined()
  })
})

describe('GET /api/auth/me', () => {
  it('answers 200 with a null viewer when nobody is signed in', async () => {
    const server = await build()

    const response = await server.inject({ method: 'GET', url: '/api/auth/me' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ viewer: null })
  })

  it('resolves the viewer in one query, not two', async () => {
    const server = await build()
    await givenAccount({ email: 'ada@example.org', password: 'a good long passphrase', roles: ['admin'] })
    const cookie = cookieFrom(await login(server, 'ada@example.org', 'a good long passphrase'))
    const selects = countSelects()

    const response = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: cookie ?? '' },
    })

    expect(response.json()).toMatchObject({ viewer: { roles: ['admin'] } })
    expect(selects.count).toBe(1)
  })

  it('resolves an account with no roles at all', async () => {
    const server = await build()
    await givenAccount({ email: 'ada@example.org', password: 'a good long passphrase' })
    const cookie = cookieFrom(await login(server, 'ada@example.org', 'a good long passphrase'))

    const response = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: cookie ?? '' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ viewer: { roles: [] } })
  })

  it.each([[['admin', 'member']], [['member']], [[]]] as const)(
    'agrees with the login response about who the viewer is: %j',
    async (roles) => {
      const server = await build()
      const email = `ada-${roles.length}@example.org`
      await givenAccount({ email, password: 'a good long passphrase', roles: [...roles] })

      const loggedIn = await login(server, email, 'a good long passphrase')
      const cookie = cookieFrom(loggedIn)
      const me = await server.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: cookie ?? '' },
      })

      const fromLogin = loggedIn.json().viewer
      const fromMe = me.json().viewer

      expect(fromMe.account_id).toEqual(fromLogin.account_id)
      expect([...fromMe.roles].sort()).toEqual([...fromLogin.roles].sort())
      expect([...fromMe.roles].sort()).toEqual([...roles].sort())
    },
  )

  it('recognises the cookie from a login', async () => {
    const server = await build()
    const id = await givenAccount({
      email: 'ada@example.org',
      password: 'a good long passphrase',
      name: 'Ada',
      roles: ['member'],
    })
    const cookie = cookieFrom(await login(server, 'ada@example.org', 'a good long passphrase'))

    const response = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${SESSION_COOKIE}=${readSessionCookie(cookie) ?? ''}` },
    })

    expect(response.json()).toEqual({
      viewer: { account_id: id, name: 'Ada', avatar: null, roles: ['member'] },
    })
  })

  it('carries the name from the login itself, not only from the next request', async () => {
    const server = await build()
    await givenAccount({
      email: 'ada@example.org',
      password: 'a good long passphrase',
      name: 'Ada Lovelace',
      roles: ['member'],
    })

    const response = await login(server, 'ada@example.org', 'a good long passphrase')

    expect(response.json().viewer.name).toBe('Ada Lovelace')
  })

  it('says the name is missing rather than omitting it, for an account never filled in', async () => {
    const server = await build()
    const id = await givenAccount({ email: 'boot@example.org', password: 'a good long passphrase' })
    const cookie = cookieFrom(await login(server, 'boot@example.org', 'a good long passphrase'))

    const response = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${SESSION_COOKIE}=${readSessionCookie(cookie) ?? ''}` },
    })

    expect(response.json()).toEqual({ viewer: { account_id: id, name: null, avatar: null, roles: [] } })
  })

  it('ignores a tampered cookie rather than trusting it', async () => {
    const server = await build()
    await givenAccount({ email: 'ada@example.org', password: 'a good long passphrase' })

    const response = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${SESSION_COOKIE}=forged.signature` },
    })

    expect(response.json()).toEqual({ viewer: null })
  })

  it('ignores a valid token whose account has been deleted', async () => {
    const server = await build()
    const id = await givenAccount({ email: 'ada@example.org', password: 'a good long passphrase' })
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

describe('concurrency', () => {
  const slowAccount = () =>
    givenAccount({
      email: 'ada@example.org',
      password: 'a good long passphrase',
      params: defaultScryptParams,
    })

  const attempts = (server: FastifyInstance, count: number) =>
    Promise.all(
      Array.from({ length: count }, () => login(server, 'ada@example.org', 'a good long passphrase')),
    )

  const SLOW_TEST_TIMEOUT_MS = 15_000

  const patient = async () =>
    await build(
      {},
      {
        gate: createGate({ ...SCRYPT_GATE, timeoutMs: 60_000 }),
        bounds: {
          login: { attempts: 1000, windowMs: 60_000 },
          address: { attempts: 1000, windowMs: 60_000 },
        },
      },
    )

  it(
    'queues a third concurrent login rather than refusing it',
    async () => {
      const server = await patient()
      await slowAccount()

      const statuses = (await attempts(server, 3)).map((response) => response.statusCode)

      expect(statuses).toEqual([200, 200, 200])
    },
    SLOW_TEST_TIMEOUT_MS,
  )

  it(
    'sheds only once the queue itself is full',
    async () => {
      const server = await patient()
      await slowAccount()

      const responses = await attempts(server, 11)
      const shed = responses.filter((response) => response.statusCode === 429)

      expect(shed.length).toBeGreaterThanOrEqual(1)
      expect(responses.filter((response) => response.statusCode === 200).length).toBeGreaterThanOrEqual(10)
      expect(shed[0]?.json()).toEqual({ error: 'rate_limited' })
      expect(shed[0]?.headers['retry-after']).toBe('1')
    },
    SLOW_TEST_TIMEOUT_MS,
  )

  it(
    'releases every slot again, so a burst does not wedge login shut',
    async () => {
      const server = await patient()
      await slowAccount()

      await attempts(server, 11)

      expect((await login(server, 'ada@example.org', 'a good long passphrase')).statusCode).toBe(200)
    },
    SLOW_TEST_TIMEOUT_MS,
  )
})

describe('the timed-out branch of the gate', () => {
  it('answers the window rather than a second, so a client waits it out', async () => {
    const server = await build(
      {},
      {
        gate: createGate({
          slots: 1,
          queue: 8,
          timeoutMs: 7000,
          setTimer: (fire) => {
            const timer = setTimeout(fire, 0)

            return { clear: () => clearTimeout(timer) }
          },
        }),
      },
    )
    await givenAccount({ email: 'ada@example.org', password: 'a good long passphrase' })

    const [, second] = await Promise.all([
      login(server, 'ada@example.org', 'a good long passphrase'),
      login(server, 'ada@example.org', 'a good long passphrase'),
    ])

    expect(second?.statusCode).toBe(429)
    expect(second?.headers['retry-after']).toBe('7')
  })
})

describe('how often one client may try', () => {
  const tries = (server: FastifyInstance, count: number, email = 'ada@example.org') =>
    Array.from({ length: count }, () => login(server, email, 'wrong passphrase'))

  it('refuses one address past its allowance, and says how long to wait', async () => {
    const server = await build({}, { bounds: { address: { attempts: 2, windowMs: 60_000 } } })
    await givenAccount({ email: 'ada@example.org', password: 'a good long passphrase' })

    for (const attempt of tries(server, 2)) expect((await attempt).statusCode).toBe(401)

    const refused = await login(server, 'ada@example.org', 'wrong passphrase')
    expect(refused.statusCode).toBe(429)
    expect(refused.json()).toEqual({ error: 'rate_limited' })
    expect(retryAfter(refused)).toBeGreaterThan(50)
    expect(retryAfter(refused)).toBeLessThanOrEqual(60)
  })

  it('counts an address with no account the same, so nothing here says who exists', async () => {
    const server = await build({}, { bounds: { address: { attempts: 1, windowMs: 60_000 } } })
    await givenAccount({ email: 'ada@example.org', password: 'a good long passphrase' })

    const known = await login(server, 'ada@example.org', 'wrong passphrase')
    const unknown = await login(server, 'nobody@example.org', 'wrong passphrase')

    expect(known.statusCode).toBe(401)
    expect(unknown.statusCode).toBe(401)

    const afterKnown = await login(server, 'ada@example.org', 'wrong passphrase')
    const afterUnknown = await login(server, 'nobody@example.org', 'wrong passphrase')

    expect(afterKnown.statusCode).toBe(429)
    expect(afterUnknown.statusCode).toBe(429)
    expect(afterKnown.headers['retry-after']).toBe(afterUnknown.headers['retry-after'])
  })

  it('spends one address’s allowance without touching another’s', async () => {
    const server = await build({}, { bounds: { address: { attempts: 1, windowMs: 60_000 } } })
    await givenAccount({ email: 'ada@example.org', password: 'a good long passphrase' })
    await givenAccount({ email: 'bea@example.org', password: 'another long passphrase' })

    await login(server, 'ada@example.org', 'wrong passphrase')

    expect((await login(server, 'ada@example.org', 'wrong passphrase')).statusCode).toBe(429)
    expect((await login(server, 'bea@example.org', 'wrong passphrase')).statusCode).toBe(401)
  })

  it('forgives an address that gets it right, so a typo is not a lockout', async () => {
    const server = await build({}, { bounds: { address: { attempts: 2, windowMs: 60_000 } } })
    await givenAccount({ email: 'ada@example.org', password: 'a good long passphrase' })

    expect((await login(server, 'ada@example.org', 'wrong passphrase')).statusCode).toBe(401)
    expect((await login(server, 'ada@example.org', 'a good long passphrase')).statusCode).toBe(200)

    expect((await login(server, 'ada@example.org', 'wrong passphrase')).statusCode).toBe(401)
    expect((await login(server, 'ada@example.org', 'wrong passphrase')).statusCode).toBe(401)
  })

  it('bounds one address ahead of the gate, whatever address it cycles', async () => {
    const server = await build({}, { bounds: { login: { attempts: 2, windowMs: 60_000 } } })
    await givenAccount({ email: 'ada@example.org', password: 'a good long passphrase' })

    await login(server, 'one@example.org', 'wrong passphrase')
    await login(server, 'two@example.org', 'wrong passphrase')

    const refused = await login(server, 'ada@example.org', 'a good long passphrase')
    expect(refused.statusCode).toBe(429)
    expect(retryAfter(refused)).toBeGreaterThan(50)
    expect(retryAfter(refused)).toBeLessThanOrEqual(60)
  })

  it('does the expensive work only for an attempt it admitted', async () => {
    const server = await build({}, { bounds: { login: { attempts: 1, windowMs: 60_000 } } })
    await givenAccount({ email: 'ada@example.org', password: 'a good long passphrase' })
    await login(server, 'one@example.org', 'wrong passphrase')

    const started = Date.now()
    const refused = await login(server, 'two@example.org', 'wrong passphrase')

    expect(refused.statusCode).toBe(429)
    expect(Date.now() - started).toBeLessThan(100)
  })
})

describe('rehashing on login', () => {
  const storedHashFor = async (id: string) => {
    const db = handle?.db
    if (db === undefined) throw new Error('build() first')
    const [row] = await db.select({ hash: account.password_hash }).from(account).where(eq(account.id, id))
    return row?.hash ?? null
  }

  it('upgrades a hash made with weaker parameters, and the password still works', async () => {
    const server = await build()
    const id = await givenAccount({ email: 'ada@example.org', password: 'a good long passphrase' })
    const before = await storedHashFor(id)

    expect((await login(server, 'ada@example.org', 'a good long passphrase')).statusCode).toBe(200)

    const after = await storedHashFor(id)
    expect(after).not.toBe(before)
    expect(after).toContain(`n=${defaultScryptParams.cost}`)
    expect(needsRehash(after ?? '')).toBe(false)
    await expect(verifyPassword('a good long passphrase', after)).resolves.toBe(true)
  })

  it('leaves an already-current hash alone', async () => {
    const server = await build()
    const id = await givenAccount({
      email: 'ada@example.org',
      password: 'a good long passphrase',
      params: defaultScryptParams,
    })
    const before = await storedHashFor(id)

    await login(server, 'ada@example.org', 'a good long passphrase')

    expect(await storedHashFor(id)).toBe(before)
  })

  it('still signs the member in when the upgrade write fails', async () => {
    const server = await build()
    await givenAccount({ email: 'ada@example.org', password: 'a good long passphrase' })
    breakUpdates()

    const response = await login(server, 'ada@example.org', 'a good long passphrase')

    expect(response.statusCode).toBe(200)
    expect(cookieFrom(response)).toContain(`${SESSION_COOKIE}=`)
  })
})

describe('cross-site reachability', () => {
  const formEncodings = ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']

  it('refuses every body type a cross-site form could submit', async () => {
    const server = await build()

    for (const contentType of formEncodings) {
      const response = await server.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { 'content-type': contentType },
        payload: 'anything',
      })

      expect(response.statusCode, contentType).toBe(415)
      expect(response.headers['set-cookie'], contentType).toBeUndefined()
    }
  })

  it('still accepts the JSON the app itself sends', async () => {
    const server = await build()

    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { 'content-type': 'application/json' },
      payload: {},
    })

    expect(response.statusCode).toBe(200)
    expect(cookieFrom(response)).toContain('Max-Age=0')
  })
})

describe('caching', () => {
  it('forbids storing any identity response', async () => {
    const server = await build()
    await givenAccount({ email: 'ada@example.org', password: 'a good long passphrase' })

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

  it('refuses a shadowed session rather than picking one', () => {
    expect(
      readSessionCookie(`${SESSION_COOKIE}=attacker.token; ${SESSION_COOKIE}=real.token`),
    ).toBeUndefined()
  })

  it('refuses a duplicate even when the planted one is empty', () => {
    expect(readSessionCookie(`${SESSION_COOKIE}=; ${SESSION_COOKIE}=real.token`)).toBeUndefined()
  })

  it('does not match a cookie whose name merely ends with ours', () => {
    expect(readSessionCookie(`not_${SESSION_COOKIE}=abc.def`)).toBeUndefined()
  })
})

describe('signing up', () => {
  const signUp = (server: FastifyInstance, payload: Record<string, unknown>) =>
    server.inject({ method: 'POST', url: '/api/auth/sign-up', payload })

  const NEW = { email: 'wren@example.org', password: 'a-long-enough-password', name: 'Wren' }

  const held = () => {
    const found = handle?.db
    if (found === undefined) throw new Error('build() first')
    return found
  }

  it('makes an account with no roles at all, and signs them in', async () => {
    const server = await build()

    const made = await signUp(server, NEW)

    expect(made.statusCode).toBe(201)
    expect(made.json().viewer).toMatchObject({ name: 'Wren', roles: [] })
    expect(cookieFrom(made)).toContain(SESSION_COOKIE)
  })

  it('is who the app answers as from then on', async () => {
    const server = await build()
    const made = await signUp(server, NEW)

    const me = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: cookieFrom(made) ?? '' },
    })

    expect(me.json().viewer).toMatchObject({ name: 'Wren', roles: [] })
  })

  it('can sign in again with the password it was given', async () => {
    const server = await build()
    await signUp(server, NEW)

    const back = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: NEW.email, password: NEW.password },
    })

    expect(back.statusCode).toBe(200)
  })

  it('puts the address in their contact list, as redeeming an invite does', async () => {
    const server = await build()

    await signUp(server, NEW)

    const rows = await held().select().from(accountConnection)
    expect(rows.map((row) => [row.kind, row.value])).toEqual([['email', NEW.email]])
  })

  it('refuses an address already in use, and says no more than that', async () => {
    const server = await build()
    await signUp(server, NEW)

    const again = await signUp(server, { ...NEW, name: 'Somebody else' })

    expect(again.statusCode).toBe(409)
    expect(again.json()).toEqual({ error: 'conflict' })
  })

  it('refuses a body that is not one', async () => {
    const server = await build()

    expect((await signUp(server, { email: 'not-an-address', password: 'x', name: 'Wren' })).statusCode).toBe(
      400,
    )
    expect((await signUp(server, { email: NEW.email, password: '', name: 'Wren' })).statusCode).toBe(400)
    expect((await signUp(server, { email: NEW.email, password: NEW.password, name: ' ' })).statusCode).toBe(
      400,
    )
  })

  it('runs out of tries, on the count logging in already has', async () => {
    const server = await build({}, { bounds: { login: { attempts: 2, windowMs: 60_000 } } })

    await signUp(server, NEW)
    await signUp(server, { ...NEW, email: 'two@example.org' })

    const refused = await signUp(server, { ...NEW, email: 'three@example.org' })
    expect(refused.statusCode).toBe(429)
    expect(retryAfter(refused)).toBeGreaterThan(50)
  })
})
