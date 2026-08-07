import type { FastifyInstance, LightMyRequestResponse } from 'fastify'

import { eq } from 'drizzle-orm'
import { createHash, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Gate } from '../auth/gate.ts'
import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createGate } from '../auth/gate.ts'
import { verifyPassword } from '../auth/password.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, application, attendance, event, inviteToken } from '../db/schema.ts'

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

const givenInvite = async (
  over: { expires_at?: string; used_at?: string | null; applicantName?: string } = {},
) => {
  const token = `token-${randomUUID()}`
  const admin = randomUUID()
  await db()
    .insert(account)
    .values({ id: admin, email: `${admin}@example.org`, password_hash: null, created_at: NOW })

  let applicationId: string | null = null
  if (over.applicantName !== undefined) {
    applicationId = randomUUID()
    await db().insert(application).values({
      id: applicationId,
      answers: [],
      status: 'approved',
      applicant_name: over.applicantName,
      applicant_contact: 'somewhere',
      submitted_at: NOW,
    })
  }

  await db()
    .insert(inviteToken)
    .values({
      id: randomUUID(),
      token_hash: createHash('sha256').update(token).digest('hex'),
      application_id: applicationId,
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

  it('never echoes the token, nor the email it was minted for', async () => {
    // An invite link is unguessable but forwardable, so whoever holds it is a
    // stranger until they redeem. The email is the login identity, and confirming an
    // address has an application is an enumeration oracle. The applicant's *name* is
    // the one deliberate exception — see "the name an invite carries" below.
    const server = await build()
    const token = await givenInvite({ applicantName: 'Ada' })

    const body = (await look(server, token)).body

    expect(body).not.toContain(token)
    expect(Object.keys(JSON.parse(body))).toEqual(['status', 'name'])
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
    // token is spent with no account behind it, and the link they were sent
    // cannot be re-sent — someone with admin has to notice and mint a fresh
    // invite by hand (#91).
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
    // Both are 409, not to hide which it is — the GET answers that plainly, and
    // there is nothing to enumerate anyway with a 256-bit token — but because the
    // caller has nothing to do with the difference here. By the time the page
    // POSTs it has read the status, and all three mean the same thing: this link
    // cannot be spent.
    const server = await build()
    const spent = await givenInvite({ used_at: NOW })

    const unknown = await redeem(server, 'not-a-real-token')
    const used = await redeem(server, spent)

    expect(unknown.statusCode).toBe(409)
    expect(used.statusCode).toBe(unknown.statusCode)
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

  it('tells a caller who waited the whole window to wait longer', async () => {
    // The `timed-out` branch, which nothing reached before the gate was
    // injectable — and the only thing distinguishing its `Retry-After` from
    // `queue-full`'s. Sending a client that already waited the window straight
    // back turns a polite `Retry-After` into a hot loop against the flood the
    // gate exists to damp.
    // Over a second, deliberately: `retryAfter` rounds up to whole seconds, so a
    // shorter window makes `timed-out` and `queue-full` both `'1'` and the
    // assertion below cannot tell them — or a hardcoded number — apart.
    const gate = createGate({ slots: 1, queue: 1, timeoutMs: 1200 })
    const server = await build(() => new Date(NOW), slowHash(1400), gate)
    const first = await givenInvite()
    const second = await givenInvite()

    const holding = redeem(server, first)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const waited = await redeem(server, second, { ...applicant, email: 'other@example.org' })

    expect(waited.statusCode).toBe(429)
    // '2' here, against `queue-full`'s '1'. Asked of the gate rather than written
    // out so the two stay tied to the window; `gate.test.ts` pins the derivation.
    expect(waited.headers['retry-after']).toBe(gate.retryAfter('timed-out'))
    expect(gate.retryAfter('timed-out')).not.toBe(gate.retryAfter('queue-full'))
    expect((await holding).statusCode).toBe(201)
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

  it('still answers "is this address a member?" for as long as the invite lives', async () => {
    // The residual, pinned rather than described. The status codes differ — 409
    // for an address that has an account, 201 for one that does not — and the
    // 409 does not spend the token, so one holder can ask about as many
    // addresses as they like. What the equal-cost ordering removed was the
    // *latency* copy of that answer, which was redundant beside the status line.
    // What bounds this is cost (a gated scrypt per probe) and #57.
    //
    // If someone later spends the token on the taken-address refusal, this test
    // fails and the paragraph it belongs to has to be rewritten with it.
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
    // Load-bearing ordering: the gate is taken *after* the invite check, so a
    // caller with any old string is answered 409 without queueing behind the
    // hashing. Taking the slot first would let anyone, with no invite at all,
    // hold the same two slots logins need — a denial of service open to the
    // public rather than to invite holders.
    //
    // Asserted on the slot rather than on the hash: a gate entered above the
    // lookup still would not *hash* for a bad token, so counting hashes cannot
    // tell the two orderings apart.
    const gate = createGate({ slots: 1, queue: 0, timeoutMs: 50 })
    const server = await build(() => new Date(NOW), slowHash(120), gate)
    const held = redeem(server, await givenInvite())
    await new Promise((resolve) => setTimeout(resolve, 30))

    const stranger = await redeem(server, 'not-a-real-token')

    expect(stranger.statusCode).toBe(409)
    expect((await held).statusCode).toBe(201)
  })

  it('shares one gate with login, rather than two that spend the pool between them', async () => {
    // The bound is on libuv's four threads, so two gates of two slots would
    // spend all four. Held from the redemption side and asserted from the login
    // side: if they ever drift back to separate gates, the login gets in.
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

  it('does not create an attendance when the form offered no burn to tick', async () => {
    const server = await build()
    await givenBurn()
    const token = await givenInvite()

    const response = await redeem(server, token)

    expect(response.json().attendance).toBeNull()
    expect(await db().select().from(attendance)).toHaveLength(0)
  })
})

/**
 * #224. Almost everybody spending an invite is joining the burn that is coming, so
 * the form offers it — and the redemption may not be put at risk by the offer.
 */
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
    // One helper behind both doors, so the two cannot write differently shaped rows.
    const server = await build()
    const burn = await givenBurn()
    const token = await givenInvite()

    const response = await redeem(server, token, { ...applicant, join_event_id: burn })

    expect(response.json().attendance).toMatchObject({
      arrival_date: '2026-08-01',
      departure_date: '2026-08-03',
    })
  })

  it('still makes the account when the burn ended while the form was open', async () => {
    // The token is spent and cannot be spent again, so refusing here would strand
    // somebody with no way to finish. The account is made, the join is skipped, and
    // `attendance: null` is what the page reads to say which happened.
    const server = await build()
    const over = await givenBurn({ start_date: '2026-06-01', end_date: '2026-06-03' })
    const token = await givenInvite()

    const response = await redeem(server, token, { ...applicant, join_event_id: over })

    expect(response.statusCode).toBe(201)
    expect(response.json().attendance).toBeNull()
    expect(await db().select().from(account)).toHaveLength(2)
    expect(await db().select().from(attendance)).toHaveLength(0)
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

describe('the name an invite carries', () => {
  it('gives back what the applicant called themselves, so the form need not ask twice', async () => {
    const server = await build()
    const token = await givenInvite({ applicantName: 'Ada Lovelace' })

    expect(await look(server, token).then((response) => response.json())).toEqual({
      status: 'outstanding',
      name: 'Ada Lovelace',
    })
  })

  it('has none for an invite an admin minted directly', async () => {
    const server = await build()
    const token = await givenInvite()

    expect((await look(server, token)).json().name).toBeNull()
  })

  it('stops naming them once the link is spent or expired', async () => {
    // The trade this makes is a forwarded *live* link telling its holder whose it
    // was. A spent one has no form to fill, so naming them then would be disclosure
    // bought for nothing.
    const server = await build()
    const used = await givenInvite({ applicantName: 'Ada', used_at: '2026-07-01T00:00:00.000Z' })
    const expired = await givenInvite({ applicantName: 'Ada', expires_at: '2026-06-01T00:00:00.000Z' })

    expect((await look(server, used)).json()).toEqual({ status: 'used', name: null })
    expect((await look(server, expired)).json()).toEqual({ status: 'expired', name: null })
  })

  it('never gives back the email, which is the login identity', async () => {
    const server = await build()
    const token = await givenInvite({ applicantName: 'Ada' })

    expect(Object.keys((await look(server, token)).json())).toEqual(['status', 'name'])
  })
})

describe('the viewer a redemption answers with', () => {
  it('carries the whole thing, not two of its four fields', async () => {
    // It carried `account_id` and `roles` and nothing else, so a freshly redeemed
    // member's in-memory viewer had `name: undefined` and `avatar: undefined` — which
    // is not `null`, and the details page compares against `null`. Their first visit
    // offered "Change it" and "Back to initials" over a broken image, for a picture
    // they had never uploaded.
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
