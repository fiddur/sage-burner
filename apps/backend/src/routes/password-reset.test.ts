import type { FastifyInstance } from 'fastify'

import { apiRoutes, RESET_VALID_HOURS, resetStateSchema } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { AppDeps } from '../app.ts'
import type { DbHandle } from '../db/index.ts'
import type { Message } from '../mail/mail.ts'
import type { EmailQueue } from '../mail/queue.ts'

import { createApp } from '../app.ts'
import { readSessionCookie, SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, INSTALLATION_ID, mailSetting, passwordReset } from '../db/schema.ts'
import { createEmailQueue } from '../mail/queue.ts'
import { digestOf } from '../tokens.ts'

const NOW = '2026-08-18T09:00:00.000Z'

let handle: DbHandle | undefined
let app: FastifyInstance | undefined
let emails: EmailQueue
const posted: Message[] = []

afterEach(async () => {
  await app?.close()
  handle?.close()
  app = undefined
  handle = undefined
})

const db = () => {
  const held = handle?.db
  if (held === undefined) throw new Error('build() first')

  return held
}

const settled = async () => await emails.drain()

const build = async (env: NodeJS.ProcessEnv = {}, over: Partial<AppDeps> = {}) => {
  posted.length = 0
  emails = createEmailQueue(() => undefined)
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({
      LOG_LEVEL: 'silent',
      SESSION_SECRET: 's'.repeat(40),
      PUBLIC_ORIGIN: 'https://burn.example.org',
      ...env,
    }),
    now: () => new Date(NOW),
    defer: emails.defer,
    hash: async (password) => await Promise.resolve(`hashed:${password}`),
    send: (_transport, message) => {
      posted.push(message)

      return Promise.resolve()
    },
    ...over,
  })

  return app
}

const givenMailServer = async () => {
  await db().insert(mailSetting).values({
    id: INSTALLATION_ID,
    host: 'smtp.example.org',
    port: 587,
    secure: false,
    username: '',
    password: '',
    from_email: 'burn@example.org',
    from_name: '',
    updated_at: NOW,
  })
}

const givenAccount = async ({
  email = 'ada@example.org',
  name = 'Ada',
  password_hash = 'a-stored-hash',
  roles = ['member'],
}: {
  email?: string
  name?: string | null
  password_hash?: string | null
  roles?: ('admin' | 'member')[]
} = {}) => {
  const id = randomUUID()
  await db().insert(account).values({ id, email, name, password_hash, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  return id
}

const askFor = async (server: FastifyInstance, email: unknown) =>
  await server.inject({
    method: apiRoutes.requestPasswordReset.method,
    url: apiRoutes.requestPasswordReset.path(),
    payload: { email },
  })

const askAs = async (server: FastifyInstance, email: string, host: string) =>
  await server.inject({
    method: apiRoutes.requestPasswordReset.method,
    url: apiRoutes.requestPasswordReset.path(),
    payload: { email },
    headers: { host },
  })

const linkIn = (message: Message | undefined): string => {
  const [, link] = /https:\/\/burn\.example\.org\/reset\/([^\s"<]+)/u.exec(message?.text ?? '') ?? []

  return link ?? ''
}

const tokenPosted = async (server: FastifyInstance, email = 'ada@example.org') => {
  await askFor(server, email)
  await settled()

  return linkIn(posted[0])
}

const resetWith = async (server: FastifyInstance, token: string, password: string) =>
  await server.inject({
    method: apiRoutes.resetPassword.method,
    url: apiRoutes.resetPassword.path(token),
    payload: { password },
  })

const stateOf = async (server: FastifyInstance, token: string) =>
  await server.inject({
    method: apiRoutes.getPasswordResetState.method,
    url: apiRoutes.getPasswordResetState.path(token),
  })

const cookieFrom = (response: { headers: Record<string, unknown> }) => {
  const header = response.headers['set-cookie']

  return typeof header === 'string' ? header : undefined
}

describe('asking for a password reset', () => {
  it('posts a link to the address on the account', async () => {
    const server = await build()
    await givenMailServer()
    await givenAccount()

    await askFor(server, 'ada@example.org')
    await settled()

    expect(posted[0]?.to).toBe('ada@example.org')
  })

  it('says the link is good once, and for as long as the token lasts', async () => {
    const server = await build()
    await givenMailServer()
    await givenAccount()

    await askFor(server, 'ada@example.org')
    await settled()

    expect(posted[0]?.text).toContain(`once, and for the next ${RESET_VALID_HOURS} hours`)
  })

  it('answers the same for an address with no account as for one with', async () => {
    const server = await build()
    await givenMailServer()
    await givenAccount()

    const known = await askFor(server, 'ada@example.org')
    const stranger = await askFor(server, 'nobody@example.org')

    expect(stranger.statusCode).toBe(known.statusCode)
    expect(stranger.body).toBe(known.body)
  })

  it('posts nothing at all for an address with no account', async () => {
    const server = await build()
    await givenMailServer()

    await askFor(server, 'nobody@example.org')
    await settled()

    expect(posted).toHaveLength(0)
  })

  it('writes no reset row for an address with no account', async () => {
    const server = await build()
    await givenMailServer()

    await askFor(server, 'nobody@example.org')
    await settled()

    expect(await db().select().from(passwordReset)).toHaveLength(0)
  })

  it('stores only the hash of the token it posted', async () => {
    const server = await build()
    await givenMailServer()
    await givenAccount()

    const token = await tokenPosted(server)
    const [row] = await db().select().from(passwordReset)

    expect(row?.token_hash).toBe(digestOf(token))
  })

  it('leaves the token itself nowhere in the database', async () => {
    const server = await build()
    await givenMailServer()
    await givenAccount()

    const token = await tokenPosted(server)
    const [row] = await db().select().from(passwordReset)

    expect(row?.token_hash).not.toBe(token)
  })

  it('drops the account’s earlier reset, so only the newest link works', async () => {
    const server = await build()
    await givenMailServer()
    await givenAccount()

    const first = await tokenPosted(server)
    posted.length = 0
    const second = await tokenPosted(server)

    expect((await stateOf(server, first)).json()).toEqual({ status: 'unknown' })
    expect((await stateOf(server, second)).json()).toEqual({ status: 'outstanding' })
  })

  it('answers before the mail has gone, so a slow mail server cannot hold the request', async () => {
    const server = await build()
    await givenMailServer()
    await givenAccount()

    const response = await askFor(server, 'ada@example.org')

    expect(posted).toHaveLength(0)
    expect(response.statusCode).toBe(204)

    await settled()
    expect(posted).toHaveLength(1)
  })

  it('posts nothing where no mail server is set up', async () => {
    const server = await build()
    await givenAccount()

    await askFor(server, 'ada@example.org')
    await settled()

    expect(await db().select().from(passwordReset)).toHaveLength(0)
  })

  it('posts nothing where PUBLIC_ORIGIN is not set, rather than trusting the Host it was given', async () => {
    const server = await build({ PUBLIC_ORIGIN: undefined })
    await givenMailServer()
    await givenAccount()

    await askAs(server, 'ada@example.org', 'evil.example')
    await settled()

    expect(posted).toEqual([])
  })

  it('mints nothing either, so a stranger cannot spend a link nobody was sent', async () => {
    const server = await build({ PUBLIC_ORIGIN: undefined })
    await givenMailServer()
    await givenAccount()

    await askAs(server, 'ada@example.org', 'evil.example')
    await settled()

    expect(await db().select().from(passwordReset)).toHaveLength(0)
  })

  it('sends the link to this installation whatever Host the asking said', async () => {
    const server = await build()
    await givenMailServer()
    await givenAccount()

    await askAs(server, 'ada@example.org', 'evil.example')
    await settled()

    expect(posted[0]?.text).toContain('https://burn.example.org/reset/')
    expect(posted[0]?.text).not.toContain('evil.example')
  })

  it('refuses a body that is not an address', async () => {
    const server = await build()
    await givenMailServer()

    expect((await askFor(server, 'not-an-address')).statusCode).toBe(400)
  })

  it('turns an address away once it has asked too often, whoever it belongs to', async () => {
    const server = await build({}, { bounds: { resetAddress: { attempts: 2, windowMs: 60_000 } } })
    await givenMailServer()
    await givenAccount()

    await askFor(server, 'ada@example.org')
    await askFor(server, 'ada@example.org')
    const third = await askFor(server, 'ada@example.org')

    expect(third.statusCode).toBe(429)
  })

  it('turns a client away once it has asked too often', async () => {
    const server = await build({}, { bounds: { reset: { attempts: 2, windowMs: 60_000 } } })
    await givenMailServer()

    await askFor(server, 'one@example.org')
    await askFor(server, 'two@example.org')
    const third = await askFor(server, 'three@example.org')

    expect(third.statusCode).toBe(429)
  })
})

describe('reading what a reset link is worth', () => {
  it('calls a link nobody minted unknown', async () => {
    const server = await build()

    expect((await stateOf(server, 'a-token-nobody-minted')).json()).toEqual({ status: 'unknown' })
  })

  it('answers the shape the client reads', async () => {
    const server = await build()
    await givenMailServer()
    await givenAccount()

    const token = await tokenPosted(server)

    expect(resetStateSchema.safeParse((await stateOf(server, token)).json()).success).toBe(true)
  })

  it('calls a link past its hour expired', async () => {
    const server = await build()
    await givenMailServer()
    const id = await givenAccount()
    await db()
      .insert(passwordReset)
      .values({
        token_hash: digestOf('a-stale-token'),
        account_id: id,
        expires_at: '2026-08-18T08:00:00.000Z',
        created_at: '2026-08-18T06:00:00.000Z',
      })

    expect((await stateOf(server, 'a-stale-token')).json()).toEqual({ status: 'expired' })
  })
})

describe('spending a password reset', () => {
  it('sets the new password and signs them in', async () => {
    const server = await build()
    await givenMailServer()
    const id = await givenAccount()

    const response = await resetWith(server, await tokenPosted(server), 'a good long passphrase')

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ viewer: { account_id: id, roles: ['member'] } })
  })

  it('stores the new password, so the old one no longer signs in', async () => {
    const server = await build()
    await givenMailServer()
    const id = await givenAccount()

    await resetWith(server, await tokenPosted(server), 'a good long passphrase')
    const [row] = await db().select().from(account).where(eq(account.id, id))

    expect(row?.password_hash).toBe('hashed:a good long passphrase')
  })

  it('sends a session cookie back, the way redeeming an invite does', async () => {
    const server = await build()
    await givenMailServer()
    await givenAccount()

    const cookie = cookieFrom(await resetWith(server, await tokenPosted(server), 'a good long passphrase'))

    expect(readSessionCookie(cookie)).toBeDefined()
    expect(cookie).toContain(`${SESSION_COOKIE}=`)
  })

  it('gives a password to an account that had none, a passkey never being the only way in', async () => {
    const server = await build()
    await givenMailServer()
    const id = await givenAccount({ password_hash: null })

    const response = await resetWith(server, await tokenPosted(server), 'a good long passphrase')
    const [row] = await db().select().from(account).where(eq(account.id, id))

    expect(response.statusCode).toBe(200)
    expect(row?.password_hash).toBe('hashed:a good long passphrase')
  })

  it('deletes the row, so the same link cannot be spent twice', async () => {
    const server = await build()
    await givenMailServer()
    await givenAccount()
    const token = await tokenPosted(server)

    await resetWith(server, token, 'a good long passphrase')

    expect((await resetWith(server, token, 'another good passphrase')).statusCode).toBe(409)
  })

  it('leaves the password as it was when the same link comes back a second time', async () => {
    const server = await build()
    await givenMailServer()
    const id = await givenAccount()
    const token = await tokenPosted(server)

    await resetWith(server, token, 'a good long passphrase')
    await resetWith(server, token, 'the attacker’s passphrase')
    const [row] = await db().select().from(account).where(eq(account.id, id))

    expect(row?.password_hash).toBe('hashed:a good long passphrase')
  })

  it('refuses a link past its hour', async () => {
    const server = await build()
    await givenMailServer()
    const id = await givenAccount()
    await db()
      .insert(passwordReset)
      .values({
        token_hash: digestOf('a-stale-token'),
        account_id: id,
        expires_at: '2026-08-18T08:00:00.000Z',
        created_at: '2026-08-18T06:00:00.000Z',
      })

    expect((await resetWith(server, 'a-stale-token', 'a good long passphrase')).statusCode).toBe(409)
  })

  it('refuses a link nobody minted', async () => {
    const server = await build()

    expect((await resetWith(server, 'a-token-nobody-minted', 'a good long passphrase')).statusCode).toBe(409)
  })

  it('refuses a password too short to be one', async () => {
    const server = await build()
    await givenMailServer()
    await givenAccount()

    expect((await resetWith(server, await tokenPosted(server), 'short')).statusCode).toBe(400)
  })

  it('leaves the link live when the password it was given is refused', async () => {
    const server = await build()
    await givenMailServer()
    await givenAccount()
    const token = await tokenPosted(server)

    await resetWith(server, token, 'short')

    expect((await stateOf(server, token)).json()).toEqual({ status: 'outstanding' })
  })

  it('turns a client away once it has tried too often', async () => {
    const server = await build({}, { bounds: { reset: { attempts: 1, windowMs: 60_000 } } })

    await resetWith(server, 'a-token-nobody-minted', 'a good long passphrase')
    const second = await resetWith(server, 'a-token-nobody-minted', 'a good long passphrase')

    expect(second.statusCode).toBe(429)
  })
})
