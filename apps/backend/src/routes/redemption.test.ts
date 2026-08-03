import type { FastifyInstance, LightMyRequestResponse } from 'fastify'

import { eq } from 'drizzle-orm'
import { createHash, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Gate } from '../auth/gate.ts'
import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createGate } from '../auth/gate.ts'
import { verifyPassword } from '../auth/password.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, attendance, inviteToken } from '../db/schema.ts'
import { SESSION_COOKIE } from './auth.ts'

/**
 * Redeeming an invite: the single funnel both membership paths converge on.
 *
 * Unauthenticated, and the token is the only credential — so the properties worth
 * proving are that it cannot be spent twice, that a spent or lapsed one says so
 * rather than 404ing, and that a failure anywhere leaves the token still usable.
 */

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

const build = async (
  now: () => Date = () => new Date(NOW),
  hash?: (password: string) => Promise<string>,
  gate?: Gate,
) => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: SECRET }),
    now,
    hash,
    gate,
  })
  return app
}

/** Stands in for scrypt at a known, small cost, so a wait can be asserted. */
const slowHash = (ms: number) =>
  vi.fn(async (password: string) => {
    await new Promise((resolve) => setTimeout(resolve, ms))
    return `hashed:${password}`
  })

const db = () => {
  const found = handle?.db
  if (found === undefined) throw new Error('build() first')
  return found
}

const givenInvite = async (over: { expires_at?: string; used_at?: string | null } = {}) => {
  const token = `token-${randomUUID()}`
  const admin = randomUUID()
  await db()
    .insert(account)
    .values({ id: admin, email: `${admin}@example.org`, password_hash: null, created_at: NOW })
  await db()
    .insert(inviteToken)
    .values({
      id: randomUUID(),
      token_hash: createHash('sha256').update(token).digest('hex'),
      application_id: null,
      expires_at: over.expires_at ?? '2026-08-01T00:00:00.000Z',
      used_at: over.used_at ?? null,
      created_by: admin,
    })
  return token
}

const applicant = {
  email: 'fredrik@example.org',
  password: 'a-long-enough-password',
  name: 'Fredrik',
  contact: 'fredrik on discord',
  allergies_notes: 'peanuts',
}

const look = (server: FastifyInstance, token: string): Promise<LightMyRequestResponse> =>
  server.inject({ method: 'GET', url: `/api/invites/${encodeURIComponent(token)}` })

const redeem = (
  server: FastifyInstance,
  token: string,
  body: Record<string, unknown> = applicant,
): Promise<LightMyRequestResponse> =>
  server.inject({ method: 'POST', url: `/api/invites/${encodeURIComponent(token)}/redeem`, payload: body })

describe('looking at an invite before redeeming it', () => {
  it('says a live one is outstanding', async () => {
    const server = await build()
    const token = await givenInvite()

    const response = await look(server, token)

    expect(response.statusCode).toBe(200)
    expect(response.json().status).toBe('outstanding')
  })

  it('says an expired one is expired rather than 404', async () => {
    const server = await build()
    const token = await givenInvite({ expires_at: '2026-07-01T00:00:00.000Z' })

    const response = await look(server, token)

    expect(response.statusCode).toBe(200)
    expect(response.json().status).toBe('expired')
  })

  it('says a spent one is used', async () => {
    const server = await build()
    const token = await givenInvite({ used_at: '2026-07-01T00:00:00.000Z' })

    expect((await look(server, token)).json().status).toBe('used')
  })

  it('says unknown for a token nobody minted, without saying which', async () => {
    // Same 200 and the same shape as the others: a different status code or body
    // for "no such token" would let someone probe for valid ones.
    const server = await build()

    const response = await look(server, 'not-a-real-token')

    expect(response.statusCode).toBe(200)
    expect(response.json().status).toBe('unknown')
  })

  it('never echoes the token or who it was for', async () => {
    // An invite link is unguessable but forwardable, so whoever holds it is a
    // stranger until they redeem. Naming the applicant would turn a leaked link
    // into a disclosure.
    const server = await build()
    const token = await givenInvite()

    const body = (await look(server, token)).body

    expect(body).not.toContain(token)
    expect(Object.keys(JSON.parse(body))).toEqual(['status'])
  })
})

describe('redeeming', () => {
  it('creates the account, fills in the person, and signs them in', async () => {
    const server = await build()
    const token = await givenInvite()

    const response = await redeem(server, token)

    expect(response.statusCode).toBe(201)
    expect(response.headers['set-cookie']).toContain(SESSION_COOKIE)

    const [row] = await db().select().from(account).where(eq(account.email, 'fredrik@example.org'))
    expect(row?.name).toBe('Fredrik')
    expect(row?.contact).toBe('fredrik on discord')
    expect(row?.allergies_notes).toBe('peanuts')
    expect(row?.password_hash).toBeTruthy()
  })

  it('falls back to the email when the body carries no contact', async () => {
    // The join form stopped asking how to reach someone once it had taken their
    // email — asking twice on one page was the reported confusion. The column
    // stays non-null, so the answer they already gave fills it.
    const server = await build()
    const token = await givenInvite()
    const { contact: _omitted, ...noContact } = applicant

    expect((await redeem(server, token, noContact)).statusCode).toBe(201)

    const [row] = await db().select().from(account).where(eq(account.email, 'fredrik@example.org'))
    expect(row?.contact).toBe('fredrik@example.org')
  })

  it('stamps the token used, so the same link cannot be spent twice', async () => {
    const server = await build()
    const token = await givenInvite()

    expect((await redeem(server, token)).statusCode).toBe(201)
    const second = await redeem(server, token, { ...applicant, email: 'someone.else@example.org' })

    expect(second.statusCode).toBe(409)
    expect(await db().select().from(account)).toHaveLength(2)
  })

  it('lets exactly one of two concurrent redemptions through', async () => {
    // The real race, not a simulation of one: both requests read the invite as
    // outstanding, then both await `hashPassword` (~230ms) before writing, so
    // they genuinely interleave. Only the conditional `used_at IS NULL` on the
    // stamp separates them — a plain `WHERE id = ?` lets both in and creates two
    // accounts from one invite.
    const server = await build()
    const token = await givenInvite()

    const [first, second] = await Promise.all([
      redeem(server, token, { ...applicant, email: 'first@example.org' }),
      redeem(server, token, { ...applicant, email: 'second@example.org' }),
    ])

    expect([first.statusCode, second.statusCode].toSorted()).toEqual([201, 409])
    // The admin from `givenInvite`, plus exactly one redeemer.
    expect(await db().select().from(account)).toHaveLength(2)
  })

  it('leaves the token unspent when the account cannot be written', async () => {
    // Two invites, one email. Both requests pass the email pre-check before
    // either writes, so the loser's insert meets the UNIQUE and the whole
    // transaction rolls back — including its stamp. Without the transaction its
    // token is spent with no account behind it, which cannot be recovered: the
    // person has no link and there is no re-issue path (#91).
    const server = await build()
    const [tokenA, tokenB] = [await givenInvite(), await givenInvite()]

    const [first, second] = await Promise.all([
      redeem(server, tokenA, { ...applicant, email: 'same@example.org' }),
      redeem(server, tokenB, { ...applicant, email: 'same@example.org' }),
    ])

    // 409, not "some error": losing a UNIQUE race is a conflict, and a 500 would
    // tell the caller to report a bug rather than to use a different email.
    expect([first.statusCode, second.statusCode].toSorted()).toEqual([201, 409])

    const invites = await db().select().from(inviteToken)
    expect(invites.filter((invite) => invite.used_at === null)).toHaveLength(1)
  })

  it('gives the account the member role, so it can reach member pages', async () => {
    const server = await build()
    const token = await givenInvite()

    const cookie = (await redeem(server, token)).headers['set-cookie']
    const me = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: String(cookie).split(';')[0] ?? '' },
    })

    expect(me.json().viewer.roles).toEqual(['member'])
  })

  it('links the account to the invite it came in on', async () => {
    const server = await build()
    const token = await givenInvite()

    await redeem(server, token)

    const [row] = await db().select().from(account).where(eq(account.email, 'fredrik@example.org'))
    const [invite] = await db().select().from(inviteToken)
    expect(row?.invite_token_id).toBe(invite?.id)
  })

  it('refuses an expired token and leaves it unspent', async () => {
    const server = await build()
    const token = await givenInvite({ expires_at: '2026-07-01T00:00:00.000Z' })

    expect((await redeem(server, token)).statusCode).toBe(409)
    expect(await db().select().from(account)).toHaveLength(1)
  })

  it('answers a token nobody minted exactly as it answers a spent one', async () => {
    // The GET handler hides this distinction on purpose, and said so in a comment
    // twenty lines from a POST that gave it away. Both are 409 now: the token is
    // 256 bits of CSPRNG so there is nothing to enumerate, but a file that argues
    // one way and acts the other is how the argument gets lost.
    const server = await build()
    const spent = await givenInvite({ used_at: NOW })

    const unknown = await redeem(server, 'not-a-real-token')
    const used = await redeem(server, spent)

    expect(unknown.statusCode).toBe(409)
    expect(unknown.json()).toEqual(used.json())
  })

  it('spends the hash before deciding the address is taken', async () => {
    // The oracle this closes: the 409 for a taken address used to return before
    // scrypt ran, while a success spent ~230ms in it. Anyone holding one unspent
    // invite could then ask "is this person a member?" for any address they
    // liked, repeatedly — the 409 does not spend the token — and read the answer
    // off the latency. Membership is the private fact this app holds.
    //
    // Asserted as a wait rather than a call count: a hash started and not waited
    // for would be called and still answer fast.
    const hash = slowHash(60)
    const server = await build(() => new Date(NOW), hash)
    const token = await givenInvite()
    await db()
      .insert(account)
      .values({ id: randomUUID(), email: 'fredrik@example.org', password_hash: null, created_at: NOW })

    const started = Date.now()
    const response = await redeem(server, token)

    expect(response.statusCode).toBe(409)
    expect(hash).toHaveBeenCalledWith('a-long-enough-password')
    expect(Date.now() - started).toBeGreaterThanOrEqual(50)
  })

  it('hashes for real when nothing is injected', async () => {
    // The seam above is only honest if the default is the actual scrypt, so this
    // verifies the stored hash against the password that was sent rather than
    // reading its shape. The negative case matters as much: a hash that accepts
    // anything would pass a prefix check just as well.
    const server = await build()
    const token = await givenInvite()

    expect((await redeem(server, token)).statusCode).toBe(201)

    const [row] = await db().select().from(account).where(eq(account.email, 'fredrik@example.org'))
    expect(await verifyPassword(applicant.password, row?.password_hash ?? null)).toBe(true)
    expect(await verifyPassword('not the passphrase', row?.password_hash ?? null)).toBe(false)
  })

  it('sheds rather than queueing unbounded scrypt for one replayed invite', async () => {
    // The cost of making the refusal equal-time: a taken address does not spend
    // the token, so a held invite can be replayed at this hash for as long as it
    // lives. One gate covers this and login together, because what is bounded is
    // libuv's threadpool rather than either route.
    const gate = createGate({ slots: 1, queue: 0, timeoutMs: 50 })
    const server = await build(() => new Date(NOW), slowHash(60), gate)
    const first = await givenInvite()
    const second = await givenInvite()

    const both = await Promise.all([redeem(server, first), redeem(server, second)])
    const shed = both.find((response) => response.statusCode === 429)

    expect(shed).toBeDefined()
    expect(shed?.json()).toEqual({ error: 'rate_limited' })
    expect(shed?.headers['retry-after']).toBe('1')
  })

  it('gives the slot back, so one redemption does not wedge the next', async () => {
    // A leaked slot holds until the process restarts. With one slot, a second
    // request through the same app is the shortest thing that notices.
    const gate = createGate({ slots: 1, queue: 4, timeoutMs: 5000 })
    const server = await build(() => new Date(NOW), slowHash(5), gate)
    const first = await givenInvite()
    const second = await givenInvite()

    expect((await redeem(server, first)).statusCode).toBe(201)
    const after = await redeem(server, second, { ...applicant, email: 'someone.else@example.org' })

    expect(after.statusCode).toBe(201)
  })

  it('lets a redemption through when the gate is not saturated', async () => {
    // The passing sibling: shedding everything would satisfy the test above.
    const gate = createGate({ slots: 1, queue: 4, timeoutMs: 5000 })
    const server = await build(() => new Date(NOW), undefined, gate)
    const token = await givenInvite()

    expect((await redeem(server, token)).statusCode).toBe(201)
  })

  it('refuses an email that already has an account, without spending the token', async () => {
    // Otherwise the token is gone and the person is told a name is taken, with no
    // way to try again.
    const server = await build()
    const token = await givenInvite()
    await db()
      .insert(account)
      .values({ id: randomUUID(), email: 'fredrik@example.org', password_hash: null, created_at: NOW })

    const response = await redeem(server, token)

    expect(response.statusCode).toBe(409)
    const [invite] = await db().select().from(inviteToken)
    expect(invite?.used_at).toBeNull()
  })

  it('takes a password of any shape, and spends the invite on it', async () => {
    // No length or composition rule: what makes a good password is the member's
    // business, and a floor here mostly pushes people to the one they reuse.
    const server = await build()
    const token = await givenInvite()

    const response = await redeem(server, token, { ...applicant, password: 'hi' })

    expect(response.statusCode).toBe(201)
    const [invite] = await db().select().from(inviteToken)
    expect(invite?.used_at).not.toBeNull()
  })

  it('refuses an empty password, which is not one', async () => {
    const server = await build()
    const token = await givenInvite()

    const response = await redeem(server, token, { ...applicant, password: '' })

    expect(response.statusCode).toBe(400)
    const [invite] = await db().select().from(inviteToken)
    expect(invite?.used_at).toBeNull()
  })

  it('refuses a body with no name, which is the one thing the form insists on', async () => {
    const server = await build()
    const token = await givenInvite()

    expect((await redeem(server, token, { ...applicant, name: '   ' })).statusCode).toBe(400)
  })

  it('refuses an unrecognised key rather than dropping it', async () => {
    const server = await build()
    const token = await givenInvite()

    expect((await redeem(server, token, { ...applicant, roles: ['admin'] })).statusCode).toBe(400)
  })

  it('lowercases the email, so one human cannot become two accounts', async () => {
    const server = await build()
    const token = await givenInvite()

    await redeem(server, token, { ...applicant, email: 'Fredrik@Example.ORG' })

    const [row] = await db().select().from(account).where(eq(account.email, 'fredrik@example.org'))
    expect(row).toBeDefined()
  })

  it('does not create an attendance — coming to a burn is a separate act', async () => {
    const server = await build()
    const token = await givenInvite()

    await redeem(server, token)

    expect(await db().select().from(attendance)).toHaveLength(0)
  })
})
