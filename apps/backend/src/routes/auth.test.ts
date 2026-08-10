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
import { account, accountRole } from '../db/schema.ts'

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

/**
 * Let the first `n` selects through, then throw.
 *
 * Enough to fail one specific query in a handler that runs several, which is
 * what it takes to pin the order they run in.
 */
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

/**
 * Count `select` calls on the live handle.
 *
 * The only way to observe "rejected before touching the database": the response
 * is an identical 401 either way, so an assertion on it cannot tell the schema
 * guard from a full lookup that failed to match.
 */
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

/**
 * Make every `update` on the live handle throw.
 *
 * Patched on the handle rather than mocked at the module boundary, so the route
 * runs unchanged and the failure arrives from where a real one would — a full
 * disk, a locked database.
 */
const breakUpdates = () => {
  const db = handle?.db
  if (db === undefined) throw new Error('build() first')
  db.update = () => {
    throw new Error('database is locked')
  }
}

/**
 * No `server` argument: it took one and never used it, reading the module-level
 * `handle` instead — which read as though the helper were scoped to that server.
 */
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
    // `SESSION_TTL_SECONDS` reaches a browser here and nowhere else, and nothing
    // asserted it: changing the login path to `cookieHeader(…, 0)` passed the
    // whole file, because the two round-trip tests re-inject the header by hand
    // and the only Max-Age assertion was logout's, which pins 0.
    //
    // The member-visible symptom would be signing in and being signed out on the
    // next page load.
    const server = await build({ SESSION_TTL_SECONDS: '3600' })
    await givenAccount({ email: 'ada@example.org', password: 'a good long passphrase' })

    const cookie = cookieFrom(await login(server, 'ada@example.org', 'a good long passphrase'))

    expect(cookie).toContain('Max-Age=3600')
  })

  it('omits Secure outside production, which is `pnpm dev` and not compose', async () => {
    // Named carefully: the image sets NODE_ENV=production, so a containerised
    // deployment — including `docker compose up` — *does* get Secure. The
    // environment this covers is local development against `pnpm dev`.
    //
    // The failure that makes it worth having: over plain HTTP the browser
    // discards a Secure cookie silently, the login still answers 200, and the
    // UI renders signed-in before the next load comes back signed out.
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
    // The account table's UNIQUE is BINARY, so a lookup that does not normalise
    // fails to find an account that plainly exists. Typing `Ada@Example.org`
    // into a login form is the ordinary case, not an edge one.
    const server = await build()
    await givenAccount({ email: 'ada@example.org', password: 'a good long passphrase' })

    expect((await login(server, '  Ada@Example.ORG  ', 'a good long passphrase')).statusCode).toBe(200)
  })

  it('answers the same way for a wrong password and an unknown address', async () => {
    // Differing here is an account-enumeration oracle: it tells anyone who asks
    // which addresses belong to members, which is the private part of a
    // membership app.
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
    await givenAccount({ email: 'ada@example.org' })

    // Only this line reaches the null-hash path. An empty password used to be
    // asserted here too, and could not: `loginPasswordSchema` is `.min(1)`, so
    // it fails `safeParse` and returns 401 from the guard at the top of
    // `handleLogin`, before the account is looked up at all — the same 401 it
    // would give for an address that does not exist, and the same one it would
    // give if `verifyPassword` returned true for a null hash.
    expect((await login(server, 'ada@example.org', 'anything')).statusCode).toBe(401)
  })

  it('rejects an empty password before touching the database', async () => {
    // What the misplaced assertion above was actually testing — and it needs to
    // be checked this way, because the response is an identical 401 whether the
    // schema rejected it or a lookup ran and failed to match. Counting reads is
    // the only thing that distinguishes them.
    const server = await build()
    await givenAccount({ email: 'ada@example.org', password: 'a good long passphrase' })
    const selects = countSelects()

    const response = await login(server, 'ada@example.org', '')

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'invalid_credentials' })
    expect(selects.count).toBe(0)
  })

  it('does read the database for a password that could have been right', async () => {
    // The other half: without it, the assertion above would pass against a
    // handler that never queried at all.
    const server = await build()
    await givenAccount({ email: 'ada@example.org', password: 'a good long passphrase' })
    const selects = countSelects()

    await login(server, 'ada@example.org', 'wrong but well-formed')

    expect(selects.count).toBeGreaterThan(0)
  })

  it('issues no cookie when the viewer lookup fails', async () => {
    // The cookie is set after every query that can fail, not before. `reply
    // .header` sticks to the reply, so the natural order — issue, then read the
    // viewer — answers 500 with a valid session attached: the member is told the
    // login failed while being signed in, and their next request works for no
    // reason they can see.
    const server = await build()
    await givenAccount({ email: 'ada@example.org', password: 'a good long passphrase' })
    breakSelectsAfter(1) // the password lookup succeeds; the viewer lookup does not

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
    // Not 401: an anonymous visitor on the public homepage is expected, and the
    // client should not have to treat rendering signed-out as a failure.
    const server = await build()

    const response = await server.inject({ method: 'GET', url: '/api/auth/me' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ viewer: null })
  })

  it('resolves the viewer in one query, not two', async () => {
    // `viewerFor` runs on every guarded request. It used to check the account
    // exists and then fetch roles separately; a left join answers both, and the
    // join has to be *left* so an account with no roles still resolves.
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
    // The left join's reason for being left: an applicant checking on their
    // application is signed in with no role, and an inner join would 401 them.
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

  // Both routes answer with a `Viewer`, and only `/me` was covered — so nothing
  // would notice if the two disagreed. They read it through one function now,
  // `viewerOf`, which is what made them stop being able to; this is what says so,
  // and what would fail if a third caller went back to assembling its own.
  //
  // `it.each` rather than a loop inside one `it`: `build()` overwrites the
  // module-level `handle` and `app`, and `afterEach` closes only whatever was
  // assigned last, so looping dropped two Fastify instances and two database
  // handles on the floor each run.
  //
  // Three shapes, because the interesting disagreements are at the edges: two roles,
  // one role, and none at all — the last being where a left join and an inner join
  // differ.
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

      // Compared as a set, not a sequence. Nothing in the query orders the roles —
      // the plan happens to walk the `(account_id, role)` composite-PK index —
      // and `toEqual` on the whole viewer would pin that accident as though it
      // were the contract. Role order is not part of the contract.
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

    // The whole body, not a subset: the point of this viewer is what it does *not*
    // carry. `name` is here for the initials in the corner; the address is not.
    expect(response.json()).toEqual({
      viewer: { account_id: id, name: 'Ada', avatar: null, roles: ['member'] },
    })
  })

  it('carries the name from the login itself, not only from the next request', async () => {
    // The login response populates the viewer directly — `Login.tsx` sets it from
    // there rather than refetching — so a name resolved only by `me` would leave the
    // corner showing the fallback glyph until a reload.
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
    // The bootstrap admin, which `admin:create` makes with an address and nothing
    // else. A missing key would fail `viewerSchema`, which requires it as nullable.
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
    // The signature proves the token was ours, not that the row still exists.
    // #35 will delete accounts; this is the path that must not resurrect one.
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
  // Not the rate limiter below — the availability guard. scrypt runs on libuv's
  // four-slot threadpool, which @fastify/static reads files through, so a
  // client holding concurrent logins would otherwise stall the whole app.
  //
  // These use production parameters deliberately: with `cheap` ones the
  // requests finish serially and never overlap, so they would pass with no
  // gate at all.
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

  // 15s rather than vitest's 5s default. These deliberately use production
  // scrypt parameters, so the slowest drives twelve hashes through two slots —
  // ~1.6s here, and a shared CI runner doing 64 MiB scrypt on contended cores
  // can plausibly eat a 3x margin. A red CI that says nothing about the code is
  // worse than a slow test.
  const SLOW_TEST_TIMEOUT_MS = 15_000

  // The gate's own window, injected rather than left at `SCRYPT_GATE`'s five seconds (#61).
  // A contended runner that crossed it resolved waiters as `timed-out`, which reads as a
  // broken gate — an earlier `retry-after: 5` and fewer than ten admissions — and raising
  // vitest's timeout could not rescue a window the route did not take as an argument.
  // Bounds wide enough to be out of the way as well: these are about the gate, and eleven
  // concurrent attempts on one address would otherwise be shed by the limiter for a different
  // reason than the queue.
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
      // The property that matters. A hard cap refused here, which turned two
      // sustained anonymous requests into a permanent outage of the only way
      // into the app — nothing to wait out, nothing to retry into.
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
      // Two running plus eight waiting; the eleventh has nowhere to go. The queue
      // is bounded so it cannot become the exhaustion it exists to prevent.
      const server = await patient()
      await slowAccount()

      const responses = await attempts(server, 11)
      const shed = responses.filter((response) => response.statusCode === 429)

      expect(shed.length).toBeGreaterThanOrEqual(1)
      expect(responses.filter((response) => response.statusCode === 200).length).toBeGreaterThanOrEqual(10)
      expect(shed[0]?.json()).toEqual({ error: 'rate_limited' })
      // `1`, not the window a timed-out caller gets: a full queue clears as the work in
      // flight finishes.
      expect(shed[0]?.headers['retry-after']).toBe('1')
    },
    SLOW_TEST_TIMEOUT_MS,
  )

  it(
    'releases every slot again, so a burst does not wedge login shut',
    async () => {
      // The release is in a `finally`; without it a throw leaks a slot and login
      // degrades permanently until a restart.
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
    // A timer that fires on the next macrotask, not synchronously: `createGate` builds the
    // entry before pushing it, so a same-tick callback would read `entry` in its own TDZ.
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
    expect(refused.headers['retry-after']).toBe('60')
  })

  it('counts an address with no account the same, so nothing here says who exists', async () => {
    // The bound is keyed on what was sent, never on whether it names an account — keying or
    // answering differently would reintroduce the enumeration oracle the constant-time verify
    // closes (#57).
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
    // The availability half: an attacker cycling addresses never fills a per-address bucket,
    // so without this two sustained requests hold the gate's whole capacity (#57).
    const server = await build({}, { bounds: { login: { attempts: 2, windowMs: 60_000 } } })
    await givenAccount({ email: 'ada@example.org', password: 'a good long passphrase' })

    await login(server, 'one@example.org', 'wrong passphrase')
    await login(server, 'two@example.org', 'wrong passphrase')

    const refused = await login(server, 'ada@example.org', 'a good long passphrase')
    expect(refused.statusCode).toBe(429)
    expect(refused.headers['retry-after']).toBe('60')
  })

  it('does the expensive work only for an attempt it admitted', async () => {
    // The point of the bound is the CPU, and the decoy derivation means even an unknown
    // address costs a full scrypt — so the refusal has to come before the hash.
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
  // Every account in this file is created with `cheap` parameters, so every
  // successful login above already takes this branch. Nothing asserted what it
  // did — and it is the only path here that writes to member data.
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
    // The point of the upgrade is that it is transparent: same password, new
    // hash. Writing a hash of the wrong thing would lock the member out on
    // their *next* login, not this one.
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
    // The whole reason that write is wrapped: a full disk or a locked database
    // must not turn a correct password into a failed login.
    const server = await build()
    await givenAccount({ email: 'ada@example.org', password: 'a good long passphrase' })
    breakUpdates()

    const response = await login(server, 'ada@example.org', 'a good long passphrase')

    expect(response.statusCode).toBe(200)
    expect(cookieFrom(response)).toContain(`${SESSION_COOKIE}=`)
  })
})

describe('cross-site reachability', () => {
  // `SameSite=Lax` protects less than it appears to. It stops the cookie being
  // *sent* cross-site, which covers every route that needs a session — but
  // logout does not need one: it ignores the body and answers with a clearing
  // `Set-Cookie`, and a Set-Cookie on a top-level cross-site navigation is
  // honoured. The only body type an HTML form can send that Fastify would parse
  // is `text/plain`, so that parser is removed.
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
    // The guard must not cost the real client anything.
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
    // These carry per-identity data with no validators, which makes them
    // heuristically cacheable — by the browser's own HTTP cache, which `fetch`
    // uses by default, and by anything in front. The failure that matters is
    // logout: the cookie is gone, but a reload answered from cache still shows
    // the old viewer, and signed sessions give the server no second chance to
    // notice.
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
    // RFC 6265 orders by descending path specificity, so an attacker who can
    // set cookies for the domain plants a valid token of their own at
    // `Path=/api` and it arrives first. Taking it would sign the member into
    // the attacker's account, where their contact details and allergies would
    // then be typed. Refusing both signs them out instead.
    expect(
      readSessionCookie(`${SESSION_COOKIE}=attacker.token; ${SESSION_COOKIE}=real.token`),
    ).toBeUndefined()
  })

  it('refuses a duplicate even when the planted one is empty', () => {
    expect(readSessionCookie(`${SESSION_COOKIE}=; ${SESSION_COOKIE}=real.token`)).toBeUndefined()
  })

  it('does not match a cookie whose name merely ends with ours', () => {
    // `not_sage_session=…` must not be read as the session.
    expect(readSessionCookie(`not_${SESSION_COOKIE}=abc.def`)).toBeUndefined()
  })
})
