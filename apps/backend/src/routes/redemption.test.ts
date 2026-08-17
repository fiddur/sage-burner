import type { FastifyInstance, LightMyRequestResponse } from 'fastify'

import { eq } from 'drizzle-orm'
import { createHash, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AppDeps } from '../app.ts'
import type { Gate } from '../auth/gate.ts'
import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createGate } from '../auth/gate.ts'
import { verifyPassword } from '../auth/password.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import {
  account,
  accountAllergy,
  accountConnection,
  allergyItem,
  application,
  attendance,
  event,
  inviteRedemption,
  inviteToken,
  notification,
  notificationSetting,
  thread,
  threadEntry,
} from '../db/schema.ts'

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
  bounds?: AppDeps['bounds'],
) => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: SECRET }),
    now,
    hash,
    gate,
    bounds,
  })
  return app
}

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

const givenInvite = async (
  over: {
    expires_at?: string
    used_at?: string | null
    applicantName?: string
    applicantEmail?: string
    kind?: 'single' | 'group'
    max_uses?: number | null
    revoked_at?: string | null
  } = {},
) => {
  const token = `token-${randomUUID()}`
  const admin = randomUUID()
  await db()
    .insert(account)
    .values({ id: admin, email: `${admin}@example.org`, password_hash: null, created_at: NOW })

  let applicationId: string | null = null
  if (over.applicantName !== undefined) {
    applicationId = randomUUID()
    await db()
      .insert(application)
      .values({
        id: applicationId,
        answers: [],
        status: 'approved',
        applicant_name: over.applicantName,
        applicant_email: over.applicantEmail ?? 'ada@example.org',
        submitted_at: NOW,
      })
  }

  await db()
    .insert(inviteToken)
    .values({
      id: randomUUID(),
      token_hash: createHash('sha256').update(token).digest('hex'),
      application_id: applicationId,
      kind: over.kind ?? 'single',
      label: over.kind === 'group' ? 'The Facebook group' : null,
      max_uses: over.max_uses ?? null,
      revoked_at: over.revoked_at ?? null,
      expires_at: over.expires_at ?? '2026-08-01T00:00:00.000Z',
      used_at: over.used_at ?? null,
      created_by: admin,
    })
  return token
}

const givenBurn = async (over: { end_date?: string; start_date?: string } = {}) => {
  const id = randomUUID()
  await db()
    .insert(event)
    .values({
      id,
      name: 'Summer burn',
      slug: `summer-${id}`,
      start_date: over.start_date ?? '2026-08-01',
      end_date: over.end_date ?? '2026-08-03',
      start_time: '16:00',
      end_time: '12:00',
      member_cap: 42,
      created_at: NOW,
    })
  return id
}

const givenMemberComing = async (eventId: string, category: 'member_joined') => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, name: 'Bea', password_hash: null, created_at: NOW })
  await db()
    .insert(attendance)
    .values({ id: randomUUID(), event_id: eventId, account_id: id, joined_at: NOW })
  await db().insert(notificationSetting).values({ account_id: id, category, enabled: true })

  return id
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

describe('the allergies somebody ticks on the way in', () => {
  it('lands on the account, the same vocabulary the rest of the app uses', async () => {
    const server = await build()
    const token = await givenInvite()
    const item = randomUUID()
    await db().insert(allergyItem).values({ id: item, order: 0, label: 'Peanuts' })

    const response = await redeem(server, token, { ...applicant, allergy_item_ids: [item] })
    expect(response.statusCode).toBe(201)

    const ticked = await db().select().from(accountAllergy)
    expect(ticked).toHaveLength(1)
    expect(ticked[0]?.item_id).toBe(item)
  })

  it('answers 400 rather than 500 for an item that has since been deleted', async () => {
    const server = await build()
    const token = await givenInvite()

    const response = await redeem(server, token, { ...applicant, allergy_item_ids: [randomUUID()] })

    expect(response.statusCode).toBe(400)
    const [invite] = await db().select().from(inviteToken)
    expect(invite?.used_at, 'a refused redemption must not spend the token').toBeNull()
  })

  it('takes none at all, the whole field being optional', async () => {
    const server = await build()
    const token = await givenInvite()

    expect((await redeem(server, token, applicant)).statusCode).toBe(201)
    expect(await db().select().from(accountAllergy)).toHaveLength(0)
  })
})

describe('a group link, which many people come in on', () => {
  it('is still live after somebody has used it, which is the whole point', async () => {
    const server = await build()
    const token = await givenInvite({ kind: 'group' })

    expect((await redeem(server, token)).statusCode).toBe(201)
    expect((await redeem(server, token, { ...applicant, email: 'bo@example.org' })).statusCode).toBe(201)
  })

  it('leaves invite_token_id null and keeps the arrival in its own list', async () => {
    const server = await build()
    const token = await givenInvite({ kind: 'group' })

    await redeem(server, token)

    const [made] = await db().select().from(account).where(eq(account.email, applicant.email))
    expect(made?.invite_token_id).toBeNull()

    const arrivals = await db().select().from(inviteRedemption)
    expect(arrivals).toHaveLength(1)
    expect(arrivals[0]?.account_id).toBe(made?.id)
  })

  it('refuses past its cap, the door closing on the count rather than on one use', async () => {
    const server = await build()
    const token = await givenInvite({ kind: 'group', max_uses: 2 })

    expect((await redeem(server, token)).statusCode).toBe(201)
    expect((await redeem(server, token, { ...applicant, email: 'b@example.org' })).statusCode).toBe(201)
    expect((await redeem(server, token, { ...applicant, email: 'c@example.org' })).statusCode).toBe(409)
  })

  it('refuses a burst that fills the cap while somebody’s password is being hashed (#524)', async () => {
    let filled = false
    const server = await build(undefined, async (password) => {
      if (!filled) {
        filled = true
        const other = randomUUID()
        await db()
          .insert(account)
          .values({ id: other, email: `${other}@example.org`, password_hash: null, created_at: NOW })
        const [link] = await db().select().from(inviteToken)
        await db()
          .insert(inviteRedemption)
          .values({
            id: randomUUID(),
            token_id: link?.id ?? '',
            account_id: other,
            redeemed_at: NOW,
          })
      }

      return `hashed:${password}`
    })
    const token = await givenInvite({ kind: 'group', max_uses: 1 })

    const answer = await redeem(server, token)

    expect(answer.statusCode).toBe(409)
    expect(await db().select().from(account).where(eq(account.email, applicant.email))).toEqual([])
    expect(await db().select().from(inviteRedemption)).toHaveLength(1)
  })

  it('admits somebody where the cap is not full, which is the ordinary arrival', async () => {
    const server = await build()
    const token = await givenInvite({ kind: 'group', max_uses: 2 })

    expect((await redeem(server, token)).statusCode).toBe(201)
    expect(await db().select().from(inviteRedemption)).toHaveLength(1)
  })

  it('refuses once revoked, which is how a group link is taken back', async () => {
    const server = await build()
    const token = await givenInvite({ kind: 'group', revoked_at: NOW })

    expect((await redeem(server, token)).statusCode).toBe(409)
  })

  it('says it is full rather than outstanding before anybody types a password', async () => {
    const server = await build()
    const token = await givenInvite({ kind: 'group', max_uses: 1 })

    await redeem(server, token)

    const state = await server.inject({ method: 'GET', url: `/api/invites/${token}` })
    expect(state.json().status).toBe('full')
  })

  it('never stamps used_at, which would end a link meant to stay open', async () => {
    const server = await build()
    const token = await givenInvite({ kind: 'group' })

    await redeem(server, token)

    const [row] = await db().select().from(inviteToken)
    expect(row?.used_at).toBeNull()
  })
})

describe('how often one client may try a token', () => {
  it('refuses past its allowance, and says how long to wait', async () => {
    const server = await build(undefined, undefined, undefined, {
      redeem: { attempts: 2, windowMs: 60_000 },
    })
    const token = await givenInvite()

    expect((await redeem(server, 'no-such-token')).statusCode).toBe(409)
    expect((await redeem(server, 'nor-this-one')).statusCode).toBe(409)

    const refused = await redeem(server, token)
    expect(refused.statusCode).toBe(429)
    expect(refused.json()).toEqual({ error: 'rate_limited' })
    expect(refused.headers['retry-after']).toBe('60')
  })
})

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
    const server = await build()

    const response = await look(server, 'not-a-real-token')

    expect(response.statusCode).toBe(200)
    expect(response.json().status).toBe('unknown')
  })

  it('never echoes the token, and says nothing the applicant did not write', async () => {
    const server = await build()
    const token = await givenInvite({ applicantName: 'Ada' })

    const body = (await look(server, token)).body

    expect(body).not.toContain(token)
    expect(Object.keys(JSON.parse(body))).toEqual(['status', 'kind', 'name', 'email'])
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

  it('gives the new account its login address as a way to be reached', async () => {
    const server = await build()
    const token = await givenInvite()

    await redeem(server, token)

    const [row] = await db().select().from(account).where(eq(account.email, 'fredrik@example.org'))
    const held = await db()
      .select()
      .from(accountConnection)
      .where(eq(accountConnection.account_id, row?.id ?? ''))

    expect(held).toHaveLength(1)
    expect(held[0]).toMatchObject({ kind: 'email', value: 'fredrik@example.org', order: 0 })
  })

  it('falls back to the email when the body carries no contact', async () => {
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
    const server = await build()
    const token = await givenInvite()

    const [first, second] = await Promise.all([
      redeem(server, token, { ...applicant, email: 'first@example.org' }),
      redeem(server, token, { ...applicant, email: 'second@example.org' }),
    ])

    expect([first.statusCode, second.statusCode].toSorted()).toEqual([201, 409])
    expect(await db().select().from(account)).toHaveLength(2)
  })

  it('leaves the token unspent when the account cannot be written', async () => {
    const server = await build()
    const [tokenA, tokenB] = [await givenInvite(), await givenInvite()]

    const [first, second] = await Promise.all([
      redeem(server, tokenA, { ...applicant, email: 'same@example.org' }),
      redeem(server, tokenB, { ...applicant, email: 'same@example.org' }),
    ])

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
    const server = await build()
    const spent = await givenInvite({ used_at: NOW })

    const unknown = await redeem(server, 'not-a-real-token')
    const used = await redeem(server, spent)

    expect(unknown.statusCode).toBe(409)
    expect(used.statusCode).toBe(unknown.statusCode)
    expect(unknown.json()).toEqual(used.json())
  })

  it('spends the hash before deciding the address is taken', async () => {
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
    const server = await build()
    const token = await givenInvite()

    expect((await redeem(server, token)).statusCode).toBe(201)

    const [row] = await db().select().from(account).where(eq(account.email, 'fredrik@example.org'))
    expect(await verifyPassword(applicant.password, row?.password_hash ?? null)).toBe(true)
    expect(await verifyPassword('not the passphrase', row?.password_hash ?? null)).toBe(false)
  })

  it('sheds rather than queueing unbounded scrypt for one replayed invite', async () => {
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

  it('tells a caller who waited the whole window to wait longer', async () => {
    const gate = createGate({ slots: 1, queue: 1, timeoutMs: 1200 })
    const server = await build(() => new Date(NOW), slowHash(1400), gate)
    const first = await givenInvite()
    const second = await givenInvite()

    const holding = redeem(server, first)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const waited = await redeem(server, second, { ...applicant, email: 'other@example.org' })

    expect(waited.statusCode).toBe(429)
    expect(waited.headers['retry-after']).toBe(gate.retryAfter('timed-out'))
    expect(gate.retryAfter('timed-out')).not.toBe(gate.retryAfter('queue-full'))
    expect((await holding).statusCode).toBe(201)
  })

  it('gives the slot back, so one redemption does not wedge the next', async () => {
    const gate = createGate({ slots: 1, queue: 4, timeoutMs: 5000 })
    const server = await build(() => new Date(NOW), slowHash(5), gate)
    const first = await givenInvite()
    const second = await givenInvite()

    expect((await redeem(server, first)).statusCode).toBe(201)
    const after = await redeem(server, second, { ...applicant, email: 'someone.else@example.org' })

    expect(after.statusCode).toBe(201)
  })

  it('lets a redemption through when the gate is not saturated', async () => {
    const gate = createGate({ slots: 1, queue: 4, timeoutMs: 5000 })
    const server = await build(() => new Date(NOW), undefined, gate)
    const token = await givenInvite()

    expect((await redeem(server, token)).statusCode).toBe(201)
  })

  it('still answers "is this address a member?" for as long as the invite lives', async () => {
    const server = await build()
    const token = await givenInvite()
    await db()
      .insert(account)
      .values({ id: randomUUID(), email: 'member@example.org', password_hash: null, created_at: NOW })

    const asked = { ...applicant, email: 'member@example.org' }
    expect((await redeem(server, token, asked)).statusCode).toBe(409)
    expect((await redeem(server, token, asked)).statusCode).toBe(409)

    const [invite] = await db().select().from(inviteToken)
    expect(invite?.used_at).toBeNull()
  })

  it('takes no slot for a caller holding no live invite', async () => {
    const gate = createGate({ slots: 1, queue: 0, timeoutMs: 50 })
    const server = await build(() => new Date(NOW), slowHash(120), gate)
    const held = redeem(server, await givenInvite())
    await new Promise((resolve) => setTimeout(resolve, 30))

    const stranger = await redeem(server, 'not-a-real-token')

    expect(stranger.statusCode).toBe(409)
    expect((await held).statusCode).toBe(201)
  })

  it('shares one gate with login, rather than two that spend the pool between them', async () => {
    const gate = createGate({ slots: 1, queue: 0, timeoutMs: 50 })
    const server = await build(() => new Date(NOW), slowHash(120), gate)
    const token = await givenInvite()

    const redeeming = redeem(server, token)
    await new Promise((resolve) => setTimeout(resolve, 30))
    const login = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'someone@example.org', password: 'a good long passphrase' },
    })

    expect(login.statusCode).toBe(429)
    expect((await redeeming).statusCode).toBe(201)
  })

  it('refuses an email that already has an account, without spending the token', async () => {
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

  it('takes any shape of password above the floor, and spends the invite on it', async () => {
    const server = await build()
    const token = await givenInvite()

    const response = await redeem(server, token, { ...applicant, password: '🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥' })

    expect(response.statusCode).toBe(201)
    const [invite] = await db().select().from(inviteToken)
    expect(invite?.used_at).not.toBeNull()
  })

  it('refuses one under the floor, sign-up being open to the internet now (#489)', async () => {
    const server = await build()
    const token = await givenInvite()

    expect((await redeem(server, token, { ...applicant, password: 'hi' })).statusCode).toBe(400)

    const [invite] = await db().select().from(inviteToken)
    expect(invite?.used_at, 'a refused redemption must not spend the token').toBeNull()
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

  it('does not create an attendance when the form offered no burn to tick', async () => {
    const server = await build()
    await givenBurn()
    const token = await givenInvite()

    const response = await redeem(server, token)

    expect(response.json().attendance).toBeNull()
    expect(await db().select().from(attendance)).toHaveLength(0)
  })
})

describe('joining the ticked burn while redeeming', () => {
  it('puts them on the list for it, and says so', async () => {
    const server = await build()
    const burn = await givenBurn()
    const token = await givenInvite()

    const response = await redeem(server, token, { ...applicant, join_event_id: burn })

    expect(response.statusCode).toBe(201)
    expect(response.json().attendance).toMatchObject({ event_id: burn, payment_status: 'unpaid' })
    expect(await db().select().from(attendance)).toHaveLength(1)
  })

  it('books the whole burn, the same as the button on the details page', async () => {
    const server = await build()
    const burn = await givenBurn()
    const token = await givenInvite()

    const response = await redeem(server, token, { ...applicant, join_event_id: burn })

    expect(response.json().attendance).toMatchObject({
      arrival_date: '2026-08-01',
      departure_date: '2026-08-03',
    })
  })

  it('opens their card on the feed, which the join button has always done', async () => {
    const server = await build()
    const burn = await givenBurn()
    const token = await givenInvite()

    await redeem(server, token, { ...applicant, join_event_id: burn })

    const [card] = await db().select().from(thread)
    expect(card?.entity_type).toBe('attendance')
    expect(card?.event_id).toBe(burn)
    expect((await db().select().from(threadEntry)).map((entry) => [entry.kind, entry.body])).toEqual([
      ['joined', 'is coming'],
    ])
  })

  it('tells whoever asked to hear about an arrival, and never the arrival', async () => {
    const server = await build()
    const burn = await givenBurn()
    const token = await givenInvite()
    const waiting = await givenMemberComing(burn, 'member_joined')

    await redeem(server, token, { ...applicant, join_event_id: burn })

    const told = await db().select().from(notification)
    expect(told.map((one) => [one.account_id, one.category, one.body])).toEqual([
      [waiting, 'member_joined', 'Fredrik is coming.'],
    ])
  })

  it('still makes the account when the burn ended while the form was open', async () => {
    const server = await build()
    const over = await givenBurn({ start_date: '2026-06-01', end_date: '2026-06-03' })
    const token = await givenInvite()

    const response = await redeem(server, token, { ...applicant, join_event_id: over })

    expect(response.statusCode).toBe(201)
    expect(response.json().attendance).toBeNull()
    expect(await db().select().from(account)).toHaveLength(2)
    expect(await db().select().from(attendance)).toHaveLength(0)
  })

  it('still makes the account when joining fails for a reason nobody planned for', async () => {
    const server = await build()
    const burn = await givenBurn()
    const token = await givenInvite()
    handle?.client.exec('DROP TABLE attendance')

    const response = await redeem(server, token, { ...applicant, join_event_id: burn })

    expect(response.statusCode).toBe(201)
    expect(response.json().attendance).toBeNull()
    expect(response.json().viewer.roles).toEqual(['member'])
    expect(await db().select().from(account)).toHaveLength(2)
  })

  it('still makes the account when the id names no burn at all', async () => {
    const server = await build()
    const token = await givenInvite()

    const response = await redeem(server, token, {
      ...applicant,
      join_event_id: '2b1f0a9c-0000-4000-8000-000000000000',
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().attendance).toBeNull()
    expect(await db().select().from(account)).toHaveLength(2)
  })

  it('spends nothing on a burn id that is not an id, and leaves the token alone', async () => {
    const server = await build()
    const token = await givenInvite()

    const response = await redeem(server, token, { ...applicant, join_event_id: 'the-summer-one' })

    expect(response.statusCode).toBe(400)
    expect(await db().select().from(account)).toHaveLength(1)
    const [invite] = await db().select().from(inviteToken)
    expect(invite?.used_at).toBeNull()
  })
})

describe('what an invite carries', () => {
  it('gives back what the applicant called themselves, so the form need not ask twice', async () => {
    const server = await build()
    const token = await givenInvite({ applicantName: 'Ada Lovelace' })

    expect(await look(server, token).then((response) => response.json())).toEqual({
      status: 'outstanding',
      kind: 'single',
      name: 'Ada Lovelace',
      email: 'ada@example.org',
    })
  })

  it('has none for an invite an admin minted directly', async () => {
    const server = await build()
    const token = await givenInvite()

    expect((await look(server, token)).json().name).toBeNull()
  })

  it('stops naming them once the link is spent or expired', async () => {
    const server = await build()
    const used = await givenInvite({ applicantName: 'Ada', used_at: '2026-07-01T00:00:00.000Z' })
    const expired = await givenInvite({ applicantName: 'Ada', expires_at: '2026-06-01T00:00:00.000Z' })

    expect((await look(server, used)).json()).toEqual({
      status: 'used',
      kind: 'single',
      name: null,
      email: null,
    })
    expect((await look(server, expired)).json()).toEqual({
      status: 'expired',
      kind: 'single',
      name: null,
      email: null,
    })
  })

  it('gives back the address the invite was posted to, so the form need not ask either', async () => {
    const server = await build()
    const token = await givenInvite({ applicantName: 'Ada', applicantEmail: 'ada@example.org' })

    expect((await look(server, token)).json().email).toBe('ada@example.org')
  })

  it('has no address either for an invite an admin minted directly', async () => {
    const server = await build()
    const token = await givenInvite()

    expect((await look(server, token)).json().email).toBeNull()
  })
})

describe('the viewer a redemption answers with', () => {
  it('carries the whole thing, not two of its four fields', async () => {
    const server = await build()
    const token = await givenInvite()

    const response = await redeem(server, token)

    expect(response.json().viewer).toEqual({
      account_id: expect.any(String),
      name: 'Fredrik',
      avatar: null,
      roles: ['member'],
    })
  })
})
