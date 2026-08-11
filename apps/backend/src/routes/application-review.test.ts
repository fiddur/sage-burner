import type { FastifyInstance, LightMyRequestResponse } from 'fastify'

import { eq } from 'drizzle-orm'
import { createHash, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'
import type { Message } from '../mail/mail.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import {
  account,
  accountRole,
  application,
  attendance,
  event,
  INSTALLATION_ID,
  inviteToken,
  mailSetting,
  notification,
  thread,
  threadEntry,
} from '../db/schema.ts'
import { NO_ORIGIN, NOT_CONFIGURED } from '../mail/mail.ts'

const SECRET = 's'.repeat(40)

let handle: DbHandle | undefined
let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  handle?.close()
  app = undefined
  handle = undefined
})

const NOW = '2026-07-02T00:00:00.000Z'

/** Every send in this file lands here. Nothing in the suite opens a socket. */
const posted: Message[] = []

const build = async (now: () => Date = () => new Date(NOW)) => {
  posted.length = 0
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: SECRET }),
    now,
    send: (_transport, message) => {
      posted.push(message)
      return Promise.resolve()
    },
  })
  return app
}

/** An SMTP server, so approving somebody has somewhere to post the invite. */
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

const db = () => {
  const found = handle?.db
  if (found === undefined) throw new Error('build() first')
  return found
}

const givenAdmin = async () => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, created_at: '2026-07-01T00:00:00Z' })
  await db().insert(accountRole).values({ account_id: id, role: 'admin' })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return { id, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
}

const givenMember = async () => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, created_at: '2026-07-01T00:00:00Z' })
  await db().insert(accountRole).values({ account_id: id, role: 'member' })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return { id, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
}

const givenApplication = async (name = 'Someone', account_id: string | null = null) => {
  const id = randomUUID()
  await db()
    .insert(application)
    .values({
      id,
      account_id,
      answers: [{ question_id: randomUUID(), label: 'Why?', type: 'text', value: 'because' }],
      status: 'pending',
      applicant_name: name,
      applicant_email: 'someone@example.org',
      submitted_at: '2026-07-02T00:00:00Z',
      decided_at: null,
    })
  return id
}

/** Somebody who signed up and applied, which is every application since #476. */
const givenApplicant = async (name = 'Wren') => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, name, password_hash: null, created_at: NOW })

  return { id, application: await givenApplication(name, id) }
}

const givenBurn = async (over: { start_date?: string; end_date?: string } = {}) => {
  const id = randomUUID()
  await db()
    .insert(event)
    .values({
      id,
      name: 'Summer burn',
      slug: `summer-${id}`,
      start_date: over.start_date ?? '2026-08-01',
      end_date: over.end_date ?? '2026-08-03',
      member_cap: 42,
      created_at: NOW,
    })

  return id
}

const decide = (
  server: FastifyInstance,
  cookie: string,
  id: string,
  decision: 'approve' | 'reject',
): Promise<LightMyRequestResponse> =>
  server.inject({
    method: 'POST',
    url: `/api/admin/applications/${encodeURIComponent(id)}/${decision}`,
    headers: { cookie },
  })

const list = (server: FastifyInstance, cookie: string) =>
  server.inject({ method: 'GET', url: '/api/admin/applications', headers: { cookie } })

describe('reviewing applications', () => {
  it('lists them with their answers', async () => {
    const server = await build()
    const { cookie } = await givenAdmin()
    await givenApplication()

    const response = await list(server, cookie)

    expect(response.statusCode).toBe(200)
    expect(response.json().applications).toHaveLength(1)
    expect(response.json().applications[0].answers[0].label).toBe('Why?')
  })

  it('refuses an anonymous caller', async () => {
    const server = await build()

    expect((await server.inject({ method: 'GET', url: '/api/admin/applications' })).statusCode).toBe(401)
  })

  it('approves, stamping the decision and minting an invite', async () => {
    const server = await build()
    const { cookie } = await givenAdmin()
    const id = await givenApplication()

    const response = await decide(server, cookie, id, 'approve')

    expect(response.statusCode).toBe(200)
    expect(response.json().application.status).toBe('approved')
    expect(response.json().application.decided_at).not.toBeNull()
    expect(response.json().invite.token).toBeTruthy()
  })

  it('stores only the digest, never the token', async () => {
    const server = await build()
    const { cookie } = await givenAdmin()
    const id = await givenApplication()

    const { token } = (await decide(server, cookie, id, 'approve')).json().invite
    const [row] = await db().select().from(inviteToken)

    expect(row?.token_hash).toBe(createHash('sha256').update(token).digest('hex'))
    expect(row?.token_hash).not.toBe(token)
  })

  it('mints a different token every time', async () => {
    // The one property that cannot be recovered if it is wrong: a predictable
    // token is an open door, and nothing downstream would notice.
    const server = await build()
    const { cookie } = await givenAdmin()

    const tokens = new Set<string>()
    for (let n = 0; n < 5; n++) {
      const id = await givenApplication()
      tokens.add((await decide(server, cookie, id, 'approve')).json().invite.token)
    }

    expect(tokens.size).toBe(5)
    for (const token of tokens) expect(token.length).toBeGreaterThanOrEqual(32)
  })

  it('does not mint a second invite when approved twice', async () => {
    const server = await build()
    const { cookie } = await givenAdmin()
    const id = await givenApplication()

    const first = await decide(server, cookie, id, 'approve')
    const second = await decide(server, cookie, id, 'approve')

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(409)
    expect(await db().select().from(inviteToken)).toHaveLength(1)
  })

  it('does not let a rejection overwrite an approval', async () => {
    const server = await build()
    const { cookie } = await givenAdmin()
    const id = await givenApplication()

    await decide(server, cookie, id, 'approve')
    const response = await decide(server, cookie, id, 'reject')

    expect(response.statusCode).toBe(409)
    const [row] = await db().select().from(application).where(eq(application.id, id))
    expect(row?.status).toBe('approved')
  })

  it('rejects, stamping the decision and minting nothing', async () => {
    const server = await build()
    const { cookie } = await givenAdmin()
    const id = await givenApplication()

    const response = await decide(server, cookie, id, 'reject')

    expect(response.statusCode).toBe(200)
    expect(response.json().application.status).toBe('rejected')
    expect(response.json().application.decided_at).not.toBeNull()
    expect(response.json().invite).toBeNull()
    expect(await db().select().from(inviteToken)).toHaveLength(0)
  })

  it('answers 404 for an application that does not exist', async () => {
    const server = await build()
    const { cookie } = await givenAdmin()

    expect((await decide(server, cookie, randomUUID(), 'approve')).statusCode).toBe(404)
  })

  it('records which admin approved it', async () => {
    const server = await build()
    const admin = await givenAdmin()
    const id = await givenApplication()

    await decide(server, admin.cookie, id, 'approve')

    const [row] = await db().select().from(inviteToken)
    expect(row?.created_by).toBe(admin.id)
    expect(row?.application_id).toBe(id)
  })

  it('gives the invite exactly the advertised 30 days', async () => {
    // Against an injected clock, so this tests the window rather than the fact
    // that today is later than the fixture. On the real clock any window from
    // -29 days upward passed.
    const server = await build()
    const { cookie } = await givenAdmin()
    const id = await givenApplication()

    const { expires_at } = (await decide(server, cookie, id, 'approve')).json().invite

    expect(expires_at).toBe('2026-08-01T00:00:00.000Z')
  })

  it('lists the newest first', async () => {
    const server = await build()
    const { cookie } = await givenAdmin()
    await givenApplication('Earlier')
    const later = await givenApplication('Later')
    await db()
      .update(application)
      .set({ submitted_at: '2026-07-05T00:00:00Z' })
      .where(eq(application.id, later))

    const names = (await list(server, cookie))
      .json()
      .applications.map((entry: { applicant_name: string }) => entry.applicant_name)

    expect(names).toEqual(['Later', 'Earlier'])
  })

  it('refuses an anonymous caller on the routes that mint an invite', async () => {
    // The list route is one thing; these grant membership.
    const server = await build()
    const id = await givenApplication()

    for (const decision of ['approve', 'reject']) {
      const response = await server.inject({
        method: 'POST',
        url: `/api/admin/applications/${id}/${decision}`,
      })
      expect(response.statusCode, decision).toBe(401)
    }
    expect((await db().select().from(application))[0]?.status).toBe('pending')
  })

  it('leaves the application pending when the invite cannot be written', async () => {
    // Half an approval is worse than none: approved with no invite cannot be
    // recovered through the API, since re-approving matches nothing on
    // `status = 'pending'` and the partial unique index refuses a second invite.
    //
    // Forced by planting an invite for this application first, which that index
    // then refuses — the same failure a full disk or a busy database would give.
    const server = await build()
    const { id: adminId, cookie } = await givenAdmin()
    const id = await givenApplication()
    await db().insert(inviteToken).values({
      id: randomUUID(),
      token_hash: 'planted',
      application_id: id,
      expires_at: '2026-09-01T00:00:00Z',
      used_at: null,
      created_by: adminId,
    })

    // A 500, not a rejection: fastify catches the failed write. The point is
    // what the database looks like afterwards.
    expect((await decide(server, cookie, id, 'approve')).statusCode).toBe(500)

    const [row] = await db().select().from(application).where(eq(application.id, id))
    expect(row?.status).toBe('pending')
    expect(row?.decided_at).toBeNull()
  })
})

describe('a fresh link when the first one was lost', () => {
  const reissue = (server: FastifyInstance, cookie: string | undefined, id: string) =>
    server.inject({
      method: 'POST',
      url: `/api/admin/applications/${encodeURIComponent(id)}/invite`,
      headers: cookie === undefined ? {} : { cookie },
    })

  const digestOf = (token: string) => createHash('sha256').update(token).digest('hex')

  it('mints a new token and kills the old one, in the same row', async () => {
    // The row is updated rather than replaced, so "one invite per application"
    // stays the index's invariant — and rewriting the digest is what makes the lost
    // link dead rather than merely superseded.
    const server = await build()
    const { cookie } = await givenAdmin()
    const id = await givenApplication()
    const first = (await decide(server, cookie, id, 'approve')).json().invite.token

    const response = await reissue(server, cookie, id)

    expect(response.statusCode).toBe(200)
    const second = response.json().invite.token
    expect(second).not.toBe(first)

    const rows = await db().select().from(inviteToken).where(eq(inviteToken.application_id, id))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.token_hash).toBe(digestOf(second))
    expect(rows[0]?.token_hash).not.toBe(digestOf(first))
  })

  it('leaves the lost link unredeemable', async () => {
    // The point of the whole issue. Redeeming the old token must find nothing,
    // rather than mint a second account for the same person.
    const server = await build()
    const { cookie } = await givenAdmin()
    const id = await givenApplication()
    const lost = (await decide(server, cookie, id, 'approve')).json().invite.token

    await reissue(server, cookie, id)

    // 200 with `unknown` rather than 404: the state route answers the same shape
    // for all four cases, and `unknown` is what a digest matching nothing looks like.
    const state = await server.inject({
      method: 'GET',
      url: `/api/invites/${encodeURIComponent(lost)}`,
    })
    expect(state.statusCode).toBe(200)
    expect(state.json().status).toBe('unknown')
  })

  it('gives out a link that works', async () => {
    // The passing sibling: the replacement must be redeemable, or "the old one is
    // dead" would pass against a route that simply broke the invite.
    const server = await build()
    const { cookie } = await givenAdmin()
    const id = await givenApplication()
    await decide(server, cookie, id, 'approve')

    const fresh = (await reissue(server, cookie, id)).json().invite.token

    const state = await server.inject({
      method: 'GET',
      url: `/api/invites/${encodeURIComponent(fresh)}`,
    })
    expect(state.statusCode).toBe(200)
    expect(state.json().status).toBe('outstanding')
  })

  it('pushes the expiry out from now rather than keeping the old one', async () => {
    const server = await build()
    const { cookie } = await givenAdmin()
    const id = await givenApplication()
    await decide(server, cookie, id, 'approve')
    const stale = '2020-01-01T00:00:00.000Z'
    await db().update(inviteToken).set({ expires_at: stale })

    const response = await reissue(server, cookie, id)

    // Against the stale value and the app's own clock, not `Date.now()`: the server
    // runs on the fixed `NOW` here, so a wall-clock comparison would be testing when
    // the suite ran.
    const [row] = await db().select().from(inviteToken).where(eq(inviteToken.application_id, id))
    expect(Date.parse(response.json().invite.expires_at)).toBeGreaterThan(Date.parse(stale))
    expect(Date.parse(response.json().invite.expires_at)).toBeGreaterThan(Date.parse(NOW))
    expect(row?.expires_at).toBe(response.json().invite.expires_at)
  })

  it('records who re-issued it, not who approved it', async () => {
    const server = await build()
    const approver = await givenAdmin()
    const id = await givenApplication()
    await decide(server, approver.cookie, id, 'approve')
    const other = await givenAdmin()

    await reissue(server, other.cookie, id)

    const [row] = await db().select().from(inviteToken).where(eq(inviteToken.application_id, id))
    expect(row?.created_by).toBe(other.id)
  })

  it('refuses once the invite has been used', async () => {
    // They are already in. A fresh link then is a second account by another name —
    // the same hole from the other end.
    const server = await build()
    const { cookie } = await givenAdmin()
    const id = await givenApplication()
    await decide(server, cookie, id, 'approve')
    await db().update(inviteToken).set({ used_at: '2026-07-03T00:00:00.000Z' })

    const response = await reissue(server, cookie, id)

    expect(response.statusCode).toBe(409)
    // Its own slug, not the shared `conflict` — see `errorCodes` (#178).
    expect(response.json().error).toBe('invite_used')
  })

  it('refuses an application nobody has approved, and one that was rejected', async () => {
    const server = await build()
    const { cookie } = await givenAdmin()
    const pending = await givenApplication()
    const rejected = await givenApplication('Rejected')
    await decide(server, cookie, rejected, 'reject')

    for (const id of [pending, rejected]) {
      const response = await reissue(server, cookie, id)

      expect(response.statusCode).toBe(409)
      // The other slug, and the failing half of the pair.
      expect(response.json().error).toBe('not_approved')
    }

    expect(await db().select().from(inviteToken)).toEqual([])
  })

  it('answers 404 for an application that does not exist', async () => {
    const server = await build()
    const { cookie } = await givenAdmin()

    expect((await reissue(server, cookie, randomUUID())).statusCode).toBe(404)
  })

  it('is admin only, like everything else under the prefix', async () => {
    const server = await build()
    const { cookie } = await givenAdmin()
    const id = await givenApplication()
    await decide(server, cookie, id, 'approve')
    const member = await givenMember()

    expect((await reissue(server, undefined, id)).statusCode).toBe(401)
    expect((await reissue(server, member.cookie, id)).statusCode).toBe(403)
  })
})

describe('the invite in the applicant’s inbox', () => {
  const approveAt = (server: FastifyInstance, cookie: string, id: string) =>
    server.inject({
      method: 'POST',
      url: `/api/admin/applications/${encodeURIComponent(id)}/approve`,
      headers: { cookie, host: 'burn.example.org' },
    })

  it('carries the link, at the origin the request arrived on', async () => {
    const server = await build()
    await givenMailServer()
    const { cookie } = await givenAdmin()
    const id = await givenApplication('Ada')

    const decided = await approveAt(server, cookie, id)

    expect(posted).toHaveLength(1)
    expect(posted[0]?.to).toBe('someone@example.org')
    expect(posted[0]?.text).toContain(`http://burn.example.org/invite/${decided.json().invite.token}`)
    // And the admin is told, which is what stops them sending the same link a second
    // time (#327).
    expect(decided.json().delivery).toEqual({ sent: true, to: 'someone@example.org', reason: null })
  })

  it('is not sent when nobody has set a mail server up', async () => {
    // The ordinary state, and the whole feature is optional: the admin still has the
    // link in the response, which is how this worked before there was one.
    const server = await build()
    const { cookie } = await givenAdmin()
    const id = await givenApplication()

    const decided = await approveAt(server, cookie, id)

    expect(decided.statusCode).toBe(200)
    expect(decided.json().invite.token).toBeTruthy()
    expect(posted).toHaveLength(0)
    // A reason rather than silence: "nowhere to send it" and "the server refused" are
    // different problems and the page words them differently (#327).
    expect(decided.json().delivery).toMatchObject({ sent: false, reason: NOT_CONFIGURED })
  })

  it('is not sent for a rejection', async () => {
    const server = await build()
    await givenMailServer()
    const { cookie } = await givenAdmin()
    const id = await givenApplication()

    await decide(server, cookie, id, 'reject')

    expect(posted).toHaveLength(0)
  })

  it('is skipped for a contact that is not an address', async () => {
    // Rows written while this column was "how can we reach you" hold phone numbers
    // and Discord handles, and posting to one of those is a bounce nobody reads.
    const server = await build()
    await givenMailServer()
    const { cookie } = await givenAdmin()
    const id = await givenApplication()
    await db()
      .update(application)
      .set({ applicant_email: '@someone on discord' })
      .where(eq(application.id, id))

    const decided = await approveAt(server, cookie, id)

    expect(posted).toHaveLength(0)
    // Null, not a failure: nothing was attempted, and the present copy — "send this
    // link" — is exactly right for an applicant who left a Discord handle.
    expect(decided.json().delivery).toBeNull()
  })

  it('still approves when the mail server refuses', async () => {
    // The invite is committed before this runs, so a mail server that is down costs
    // a message rather than an approval — and the admin has the link either way.
    handle = createDb({ url: ':memory:' })
    runMigrations(handle)
    app = await createApp({
      db: handle.db,
      config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: SECRET }),
      now: () => new Date(NOW),
      send: () => Promise.reject(new Error('connect ECONNREFUSED')),
    })
    await givenMailServer()
    const { cookie } = await givenAdmin()
    const id = await givenApplication()

    const decided = await approveAt(app, cookie, id)

    expect(decided.statusCode).toBe(200)
    expect(decided.json().invite.token).toBeTruthy()
    // What was missing: the send failed and the answer said nothing, so an invite went
    // missing behind a TLS misconfiguration nobody could see (#327).
    expect(decided.json().delivery.sent).toBe(false)
    expect(decided.json().delivery.reason).toBeTruthy()
  })

  it('carries the outcome on a reissue as well', async () => {
    const server = await build()
    await givenMailServer()
    const { cookie } = await givenAdmin()
    const id = await givenApplication()
    await approveAt(server, cookie, id)

    const fresh = await server.inject({
      method: 'POST',
      url: `/api/admin/applications/${encodeURIComponent(id)}/invite`,
      headers: { cookie, host: 'burn.example.org' },
    })

    expect(fresh.json().delivery).toEqual({ sent: true, to: 'someone@example.org', reason: null })
  })

  it('says so when this installation cannot say where it lives', async () => {
    // Reachable only with a `Host` that is not hostname-shaped, since a link in an
    // inbox has to be absolute. It was a bare `return` — the one path that skipped the
    // send and did not even log (#327).
    const server = await build()
    await givenMailServer()
    const { cookie } = await givenAdmin()
    const id = await givenApplication()

    const decided = await server.inject({
      method: 'POST',
      url: `/api/admin/applications/${encodeURIComponent(id)}/approve`,
      headers: { cookie, host: 'not a host' },
    })

    expect(decided.statusCode).toBe(200)
    expect(posted).toHaveLength(0)
    expect(decided.json().delivery).toMatchObject({ sent: false, reason: NO_ORIGIN })
  })

  it('posts the replacement too, which is the case a reissue exists for', async () => {
    const server = await build()
    await givenMailServer()
    const { cookie } = await givenAdmin()
    const id = await givenApplication()
    await approveAt(server, cookie, id)

    const fresh = await server.inject({
      method: 'POST',
      url: `/api/admin/applications/${encodeURIComponent(id)}/invite`,
      headers: { cookie, host: 'burn.example.org' },
    })

    expect(posted).toHaveLength(2)
    expect(posted[1]?.text).toContain(`http://burn.example.org/invite/${fresh.json().invite.token}`)
  })
})

describe('approving somebody who signed up first', () => {
  it('makes them a member, which is what approval now is', async () => {
    // No token is minted: the account already exists, so there is nothing left to claim (#476).
    const server = await build()
    const approver = await givenAdmin()
    const wren = await givenApplicant()

    const decided = await decide(server, approver.cookie, wren.application, 'approve')

    expect(decided.statusCode).toBe(200)
    expect(decided.json().invite).toBeNull()
    const roles = await db().select().from(accountRole).where(eq(accountRole.account_id, wren.id))
    expect(roles.map((row) => row.role)).toEqual(['member'])
    expect(await db().select().from(inviteToken)).toEqual([])
  })

  it('puts them on the list for the burn that is coming', async () => {
    // Applying means wanting to come; the member changes arrival and lodging on their next visit.
    const server = await build()
    const approver = await givenAdmin()
    const burn = await givenBurn()
    const wren = await givenApplicant()

    await decide(server, approver.cookie, wren.application, 'approve')

    const [stay] = await db().select().from(attendance)
    expect(stay).toMatchObject({ event_id: burn, account_id: wren.id, payment_status: 'unpaid' })
  })

  it('opens their card on the feed, the same as every other arrival', async () => {
    const server = await build()
    const approver = await givenAdmin()
    await givenBurn()
    const wren = await givenApplicant()

    await decide(server, approver.cookie, wren.application, 'approve')

    const [card] = await db().select().from(thread)
    expect(card).toMatchObject({ entity_type: 'attendance', subject_account_id: wren.id })
  })

  it('approves where no burn is planned yet, rather than refusing', async () => {
    const server = await build()
    const approver = await givenAdmin()
    const wren = await givenApplicant()

    expect((await decide(server, approver.cookie, wren.application, 'approve')).statusCode).toBe(200)
    expect(await db().select().from(attendance)).toEqual([])
  })

  it('tells them, which is what the wait was for', async () => {
    const server = await build()
    const approver = await givenAdmin()
    const wren = await givenApplicant()

    await decide(server, approver.cookie, wren.application, 'approve')

    const told = await db().select().from(notification).where(eq(notification.account_id, wren.id))
    expect(told.map((one) => one.category)).toEqual(['application_news'])
  })

  it('tells them a rejection too, which used to send nothing at all', async () => {
    const server = await build()
    const approver = await givenAdmin()
    const wren = await givenApplicant()

    await decide(server, approver.cookie, wren.application, 'reject')

    const told = await db().select().from(notification).where(eq(notification.account_id, wren.id))
    expect(told.map((one) => one.category)).toEqual(['application_news'])
    expect(await db().select().from(accountRole).where(eq(accountRole.account_id, wren.id))).toEqual([])
  })

  it('names them on the card, rather than calling every provider sign-up Somebody', async () => {
    const server = await build()
    const approver = await givenAdmin()
    await givenBurn()
    const wren = await givenApplicant('Wren')

    await decide(server, approver.cookie, wren.application, 'approve')

    const [entry] = await db().select().from(threadEntry)
    expect(entry?.author_account_id).toBe(wren.id)
    const [card] = await db().select().from(thread)
    expect(card?.title).toBe('Wren')
  })

  it('still mints a token for an application from before there were accounts', async () => {
    // The two outstanding ones keep working: the link is all such an application can offer.
    const server = await build()
    const approver = await givenAdmin()
    const old = await givenApplication()

    const decided = await decide(server, approver.cookie, old, 'approve')

    expect(decided.json().invite).not.toBeNull()
    expect(await db().select().from(inviteToken)).toHaveLength(1)
  })
})
