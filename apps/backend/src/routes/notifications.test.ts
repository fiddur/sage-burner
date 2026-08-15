import type { FastifyInstance } from 'fastify'

import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DbHandle } from '../db/index.ts'
import type { Message } from '../mail/mail.ts'
import type { Delivery } from '../push/push.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import {
  account,
  accountRole,
  attendance,
  event,
  INSTALLATION_ID,
  mailSetting,
  notification,
  pushSubscription,
} from '../db/schema.ts'
import { createEmailQueue } from '../mail/queue.ts'

const SECRET = 's'.repeat(40)
const NOW = '2026-07-02T00:00:00.000Z'
const BURN = 'e0000000-0000-4000-8000-000000000001'

let handle: DbHandle | undefined
let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  handle?.close()
  app = undefined
  handle = undefined
  vi.restoreAllMocks()
})

const db = () => {
  const found = handle?.db
  if (found === undefined) throw new Error('build() first')
  return found
}

/** Every send in this file lands here. Nothing in the suite opens a socket. */
const posted: Message[] = []

/**
 * The queue the email leg goes on, held so a test can wait for it (#356).
 *
 * A route answering no longer means the posting has happened. Without `settled()` the
 * assertions below would be racing the queue — and winning most of the time, which is
 * the worst of the three outcomes.
 */
let emails = createEmailQueue(() => undefined)
const settled = async () => await emails.drain()

const build = async (deliver: Delivery = () => Promise.resolve('sent'), env: Record<string, string> = {}) => {
  posted.length = 0
  emails = createEmailQueue(() => undefined)
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: SECRET, ...env }),
    now: () => new Date(NOW),
    deliver,
    mintKeys: () => ({ publicKey: 'a-public-key', privateKey: 'a-private-key' }),
    defer: emails.defer,
    send: (_transport, message) => {
      posted.push(message)
      return Promise.resolve()
    },
  })
  return app
}

/** An SMTP server, so a member who asks for email has somewhere to be posted from. */
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

const cookieFor = (id: string) => {
  // The real clock, not the frozen one: `createApp` verifies sessions against the
  // real one, so a token minted at `NOW` is already weeks expired.
  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return `${SESSION_COOKIE}=${sessions.issue(id)}`
}

const givenAccount = async (roles: ('admin' | 'member')[] = ['member']) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  return { id, cookie: cookieFor(id) }
}

const givenBurn = async (cap = 3) => {
  await db().insert(event).values({
    id: BURN,
    name: 'Summer burn',
    slug: 'summer',
    start_date: '2026-08-01',
    end_date: '2026-08-03',
    member_cap: cap,
    created_at: NOW,
  })
}

const givenComing = async (accountId: string, paid = false, joined_at = NOW) => {
  await db()
    .insert(attendance)
    .values({
      id: randomUUID(),
      event_id: BURN,
      account_id: accountId,
      joined_at,
      payment_status: paid ? 'paid' : 'unpaid',
    })
}

/** Distinct joining times, so who is below the line is the fixture's to decide rather than the tie-break's. */
const joinedAt = (minutes: number) => new Date(Date.parse(NOW) + minutes * 60_000).toISOString()

const givenSubscribed = async (accountId: string) => {
  await db()
    .insert(pushSubscription)
    .values({
      id: randomUUID(),
      endpoint: `https://push.example.org/${randomUUID()}`,
      account_id: accountId,
      p256dh: 'a-key',
      auth: 'a-secret',
      created_at: NOW,
    })
}

const list = (server: FastifyInstance, cookie: string) =>
  server.inject({ method: 'GET', url: '/api/me/notifications', headers: { cookie } })

const join = (server: FastifyInstance, cookie: string) =>
  server.inject({ method: 'POST', url: `/api/events/${BURN}/attendance/me`, headers: { cookie } })

const leave = (server: FastifyInstance, cookie: string) =>
  server.inject({ method: 'DELETE', url: `/api/events/${BURN}/attendance/me`, headers: { cookie } })

const setPaid = (server: FastifyInstance, cookie: string, accountId: string) =>
  server.inject({
    method: 'PATCH',
    url: `/api/admin/events/${BURN}/attendance/${accountId}/payment`,
    headers: { cookie },
    payload: { payment_status: 'paid' },
  })

describe('the bell', () => {
  it('turns nobody away for having no role', async () => {
    // These are somebody's own records; an applicant waiting on a decision has some.
    const server = await build()
    const nobody = await givenAccount([])

    expect((await list(server, nobody.cookie)).statusCode).toBe(200)
  })

  it('refuses somebody who is not signed in', async () => {
    const server = await build()

    expect((await server.inject({ method: 'GET', url: '/api/me/notifications' })).statusCode).toBe(401)
  })

  it('records what happened, and counts it unseen', async () => {
    const server = await build()
    await givenBurn()
    const admin = await givenAccount(['admin'])
    const ada = await givenAccount()
    await givenComing(ada.id)

    await setPaid(server, admin.cookie, ada.id)

    const body = list(server, ada.cookie)
    expect((await body).json().unseen).toBe(1)
    expect((await list(server, ada.cookie)).json().notifications[0].body).toContain('payment')
  })

  it('goes grey once it has been opened', async () => {
    const server = await build()
    await givenBurn()
    const admin = await givenAccount(['admin'])
    const ada = await givenAccount()
    await givenComing(ada.id)
    await setPaid(server, admin.cookie, ada.id)

    const seen = await server.inject({
      method: 'POST',
      url: '/api/me/notifications/seen',
      headers: { cookie: ada.cookie },
    })

    expect(seen.json().unseen).toBe(0)
    // The list stays: what the bubble counts is what is new, not what is outstanding.
    expect(seen.json().notifications).toHaveLength(1)
  })

  it('shows nobody else theirs', async () => {
    const server = await build()
    await givenBurn()
    const admin = await givenAccount(['admin'])
    const ada = await givenAccount()
    const bea = await givenAccount()
    await givenComing(ada.id)
    await setPaid(server, admin.cookie, ada.id)

    expect((await list(server, bea.cookie)).json().notifications).toHaveLength(0)
  })
})

describe('what somebody has switched on', () => {
  /**
   * The ones that are on unless somebody says otherwise.
   *
   * `application` is among them for every account, admin or not — the settings are
   * per account and know nothing about roles, and only an admin is ever *told*. The
   * web hides the switch from anybody else rather than the wire pretending it is off
   * (#326).
   */
  const DEFAULTS = [
    'meal_role',
    'dream_role',
    'lead_role',
    'payment',
    'waiting_list_near',
    'waiting_list_pushed',
    'dream_comment',
    'introduction_comment',
    'post_comment',
    'song_comment',
    'bring_answered',
    'bring_role',
    'bring_comment',
    'point_comment',
    'meeting_scheduled',
    'meeting_comment',
    'mentioned',
    'lead_role_comment',
    'application',
    'application_news',
  ]

  const setOn = (server: FastifyInstance, cookie: string, on: string[], email: string[] = []) =>
    server.inject({
      method: 'PUT',
      url: '/api/me/notification-settings',
      headers: { cookie },
      payload: { on, email, digest: 'daily' },
    })

  /** Everything on except the named ones — what unticking a box used to mean. */
  const mute = (server: FastifyInstance, cookie: string, muted: string[]) =>
    setOn(
      server,
      cookie,
      DEFAULTS.filter((category) => !muted.includes(category)),
    )

  it('records nothing at all for a category switched off', async () => {
    // A bell filling with things somebody asked not to hear about is the same noise,
    // quieter. Email is a switch of its own and is off here, as it is by default.
    const deliver = vi.fn<Delivery>(() => Promise.resolve('sent'))
    const server = await build(deliver)
    await givenBurn()
    const admin = await givenAccount(['admin'])
    const ada = await givenAccount()
    await givenComing(ada.id)
    await givenSubscribed(ada.id)
    await mute(server, ada.cookie, ['payment'])

    await setPaid(server, admin.cookie, ada.id)

    expect((await list(server, ada.cookie)).json().notifications).toHaveLength(0)
    expect(deliver).not.toHaveBeenCalled()
  })

  it('still records one it has not switched off', async () => {
    // The passing sibling: muting everything would satisfy the test above.
    const server = await build()
    await givenBurn()
    const admin = await givenAccount(['admin'])
    const ada = await givenAccount()
    await givenComing(ada.id)
    await mute(server, ada.cookie, ['lead_role'])

    await setPaid(server, admin.cookie, ada.id)

    expect((await list(server, ada.cookie)).json().notifications).toHaveLength(1)
  })

  it('answers the whole set, replacing what was there', async () => {
    const server = await build()
    const ada = await givenAccount()
    await setOn(server, ada.cookie, ['payment', 'lead_role'])

    const back = await setOn(server, ada.cookie, ['meal_role'])

    expect(back.json().on).toEqual(['meal_role'])
  })

  it('records that somebody has been here, which is the whole of what a digest waits on', async () => {
    const server = await build()
    const ada = await givenAccount()

    await server.inject({
      method: 'GET',
      url: '/api/me/notification-settings',
      headers: { cookie: ada.cookie },
    })

    const [row] = await db()
      .select({ at: account.last_active_at })
      .from(account)
      .where(eq(account.id, ada.id))

    expect(row?.at).toBe(NOW)
  })

  it('answers the request even when recording the visit fails', async () => {
    const server = await build()
    const ada = await givenAccount()
    vi.spyOn(db(), 'update').mockImplementation(() => {
      throw new Error('the database went away')
    })

    const answered = await server.inject({
      method: 'GET',
      url: '/api/me/notification-settings',
      headers: { cookie: ada.cookie },
    })

    expect(answered.statusCode).toBe(200)
  })

  it('records nothing for a request carrying no session', async () => {
    const server = await build()
    const ada = await givenAccount()

    await server.inject({ method: 'GET', url: '/api/me/notification-settings' })

    const [row] = await db()
      .select({ at: account.last_active_at })
      .from(account)
      .where(eq(account.id, ada.id))

    expect(row?.at).toBeNull()
  })

  it('says a digest is daily for somebody who has never said', async () => {
    const server = await build()
    const ada = await givenAccount()

    const settings = await server.inject({
      method: 'GET',
      url: '/api/me/notification-settings',
      headers: { cookie: ada.cookie },
    })

    expect(settings.json().digest).toBe('daily')
  })

  it('remembers a digest switched off, which is what absence cannot say', async () => {
    const server = await build()
    const ada = await givenAccount()

    await server.inject({
      method: 'PUT',
      url: '/api/me/notification-settings',
      headers: { cookie: ada.cookie },
      payload: { on: [], email: [], digest: 'off' },
    })

    const settings = await server.inject({
      method: 'GET',
      url: '/api/me/notification-settings',
      headers: { cookie: ada.cookie },
    })

    expect(settings.json().digest).toBe('off')
  })

  it('refuses a digest the app has no word for', async () => {
    const server = await build()
    const ada = await givenAccount()

    const refused = await server.inject({
      method: 'PUT',
      url: '/api/me/notification-settings',
      headers: { cookie: ada.cookie },
      payload: { on: [], email: [], digest: 'hourly' },
    })

    expect(refused.statusCode).toBe(400)
  })

  it('defaults to what happens to you, and the one thing around you that cannot wait', async () => {
    const server = await build()
    const ada = await givenAccount()

    const settings = await server.inject({
      method: 'GET',
      url: '/api/me/notification-settings',
      headers: { cookie: ada.cookie },
    })

    expect(settings.json().on).toEqual(DEFAULTS)
  })

  it('has a meeting on to begin with, being the only burn news with a time to be at', async () => {
    // The exception to the section's rule, worth its own assertion rather than a name
    // buried in the list above: a dream offered can be read whenever you next look.
    const server = await build()
    const ada = await givenAccount()

    const settings = await server.inject({
      method: 'GET',
      url: '/api/me/notification-settings',
      headers: { cookie: ada.cookie },
    })

    expect(settings.json().on).toContain('meeting_scheduled')
    expect(settings.json().on).not.toContain('point_raised')
  })

  it('leaves what is going on around you off until it is asked for', async () => {
    // The half the old shape could not express: absence used to mean on, so a
    // category that is off by default had nowhere to live (#259).
    const server = await build()
    const ada = await givenAccount()

    const settings = await server.inject({
      method: 'GET',
      url: '/api/me/notification-settings',
      headers: { cookie: ada.cookie },
    })

    expect(settings.json().on).not.toContain('member_joined')
    expect(settings.json().on).not.toContain('dream_offered')
    expect(settings.json().on).not.toContain('new_version')
  })

  it('remembers one switched on, which absence alone could never say', async () => {
    const server = await build()
    const ada = await givenAccount()

    await setOn(server, ada.cookie, [...DEFAULTS, 'member_joined'])

    const settings = await server.inject({
      method: 'GET',
      url: '/api/me/notification-settings',
      headers: { cookie: ada.cookie },
    })

    expect(settings.json().on).toContain('member_joined')
  })
})

describe('the waiting list', () => {
  it('warns whoever has not paid when the burn is nearly full', async () => {
    // The only notifications not caused by an action against the person told:
    // somebody else pays, and an unpaid member's standing changes.
    const server = await build()
    await givenBurn(5)
    const admin = await givenAccount(['admin'])
    const paid = await givenAccount()
    const unpaid = await givenAccount()
    await givenComing(paid.id)
    await givenComing(unpaid.id)

    await setPaid(server, admin.cookie, paid.id)

    const theirs = (await list(server, unpaid.cookie)).json().notifications
    expect(theirs.map((one: { category: string }) => one.category)).toContain('waiting_list_near')
  })

  it('tells them when it actually filled', async () => {
    const server = await build()
    await givenBurn(1)
    const admin = await givenAccount(['admin'])
    const paid = await givenAccount()
    const unpaid = await givenAccount()
    await givenComing(paid.id)
    await givenComing(unpaid.id)

    await setPaid(server, admin.cookie, paid.id)

    const theirs = (await list(server, unpaid.cookie)).json().notifications
    expect(theirs.map((one: { category: string }) => one.category)).toContain('waiting_list_pushed')
  })

  it('tells every unpaid member the same thing while places are left (#565)', async () => {
    const server = await build()
    await givenBurn(4)
    const admin = await givenAccount(['admin'])
    const paid = await givenAccount()
    const first = await givenAccount()
    const last = await givenAccount()
    const joining = [paid, first, last]
    for (const [at, who] of joining.entries()) await givenComing(who.id, false, joinedAt(at))

    await setPaid(server, admin.cookie, paid.id)

    for (const who of [first, last]) {
      const theirs = (await list(server, who.cookie)).json().notifications
      expect(theirs.map((one: { category: string }) => one.category)).toEqual(['waiting_list_near'])
      expect(theirs[0].body).toContain('3 places left')
    }
  })

  it('says how many are left, and says one in the singular', async () => {
    const server = await build()
    await givenBurn(2)
    const admin = await givenAccount(['admin'])
    const paid = await givenAccount()
    const unpaid = await givenAccount()
    await givenComing(paid.id)
    await givenComing(unpaid.id)

    await setPaid(server, admin.cookie, paid.id)

    const [told] = (await list(server, unpaid.cookie)).json().notifications
    // #572: the count agreed and the clause after it did not — "1 place left, and *they* go".
    expect(told.body).toContain('1 place left, and it goes to whoever pays')
    expect(told.body).not.toContain('1 places')
  })

  it('says the rest of the sentence in the plural where there are several', async () => {
    const server = await build()
    await givenBurn(4)
    const admin = await givenAccount(['admin'])
    const paid = await givenAccount()
    const unpaid = await givenAccount()
    await givenComing(paid.id)
    await givenComing(unpaid.id)

    await setPaid(server, admin.cookie, paid.id)

    const [told] = (await list(server, unpaid.cookie)).json().notifications
    expect(told.body).toContain('3 places left, and they go to whoever pays')
  })

  it('tells every unpaid member it is full once the places are gone, wherever they joined', async () => {
    const server = await build()
    await givenBurn(1)
    const admin = await givenAccount(['admin'])
    const paid = await givenAccount()
    const first = await givenAccount()
    const last = await givenAccount()
    const joining = [paid, first, last]
    for (const [at, who] of joining.entries()) await givenComing(who.id, false, joinedAt(at))

    await setPaid(server, admin.cookie, paid.id)

    for (const who of [first, last]) {
      const theirs = (await list(server, who.cookie)).json().notifications
      expect(theirs.map((one: { category: string }) => one.category)).toEqual(['waiting_list_pushed'])
    }
  })

  it('tells them it is full when an admin has recorded more payments than places', async () => {
    // The old shape returned early past the cap and said nothing at all.
    const server = await build()
    await givenBurn(1)
    const admin = await givenAccount(['admin'])
    const paid = await givenAccount()
    const alsoPaid = await givenAccount()
    const unpaid = await givenAccount()
    for (const who of [paid, alsoPaid, unpaid]) await givenComing(who.id)

    await setPaid(server, admin.cookie, paid.id)
    await setPaid(server, admin.cookie, alsoPaid.id)

    const theirs = (await list(server, unpaid.cookie)).json().notifications
    expect(theirs.map((one: { category: string }) => one.category)).toEqual(['waiting_list_pushed'])
  })

  it('links the burn it is about, so the roster it names is the one that opens', async () => {
    const server = await build()
    await givenBurn(1)
    const admin = await givenAccount(['admin'])
    const paid = await givenAccount()
    const unpaid = await givenAccount()
    await givenComing(paid.id)
    await givenComing(unpaid.id)

    await setPaid(server, admin.cookie, paid.id)

    const [told] = (await list(server, unpaid.cookie)).json().notifications
    expect(told.link).toBe(`/members?burn=${BURN}`)
  })

  it('says nothing to somebody who has paid', async () => {
    const server = await build()
    await givenBurn(1)
    const admin = await givenAccount(['admin'])
    const first = await givenAccount()
    const second = await givenAccount()
    await givenComing(first.id, true)
    await givenComing(second.id)

    await setPaid(server, admin.cookie, second.id)

    const theirs = (await list(server, second.cookie)).json().notifications
    expect(theirs.map((one: { category: string }) => one.category)).not.toContain('waiting_list_pushed')
  })

  it('tells somebody who joins a burn that is already full (#564)', async () => {
    // The line, not the payment, is what has to trigger the telling: every place here is
    // paid, so nothing this member does and nothing an admin does will move it — the hook
    // would never have fired for them at all.
    const server = await build()
    await givenBurn(1)
    const admin = await givenAccount(['admin'])
    const paid = await givenAccount()
    await givenComing(paid.id)
    await setPaid(server, admin.cookie, paid.id)
    const late = await givenAccount()

    expect((await join(server, late.cookie)).statusCode).toBe(201)

    const theirs = (await list(server, late.cookie)).json().notifications
    expect(theirs.map((one: { category: string }) => one.category)).toEqual(['waiting_list_pushed'])
  })

  it('tells somebody an admin adds to a burn that is already full', async () => {
    const server = await build()
    await givenBurn(1)
    const admin = await givenAccount(['admin'])
    const paid = await givenAccount()
    await givenComing(paid.id)
    await setPaid(server, admin.cookie, paid.id)
    const added = await givenAccount()

    const put = await server.inject({
      method: 'POST',
      url: `/api/admin/events/${BURN}/attendance`,
      headers: { cookie: admin.cookie },
      payload: { account_id: added.id },
    })
    expect(put.statusCode).toBe(201)

    const theirs = (await list(server, added.cookie)).json().notifications
    expect(theirs.map((one: { category: string }) => one.category)).toEqual(['waiting_list_pushed'])
  })

  it('says nothing to somebody who joins a burn with room in it', async () => {
    // The passing sibling: telling on every join would satisfy the one above while
    // greeting every new member of every burn with a waiting-list warning.
    const server = await build()
    await givenBurn(20)
    const joiner = await givenAccount()

    expect((await join(server, joiner.cookie)).statusCode).toBe(201)

    expect((await list(server, joiner.cookie)).json().notifications).toEqual([])
  })

  it('does not tell the others again when somebody else joins', async () => {
    // A join cannot change how many places are left — the joiner is unpaid — so the
    // sentence is the one they already have, and saying it twice is what teaches people
    // to stop reading them.
    const server = await build()
    await givenBurn(2)
    const admin = await givenAccount(['admin'])
    const paid = await givenAccount()
    const waiting = await givenAccount()
    await givenComing(paid.id)
    await givenComing(waiting.id)
    await setPaid(server, admin.cookie, paid.id)
    const late = await givenAccount()

    await join(server, late.cookie)

    const theirs = (await list(server, waiting.cookie)).json().notifications
    expect(theirs.filter((one: { category: string }) => one.category === 'waiting_list_near')).toHaveLength(1)
  })

  it('tells the joiner the count the others were told', async () => {
    const server = await build()
    await givenBurn(2)
    const admin = await givenAccount(['admin'])
    const paid = await givenAccount()
    await givenComing(paid.id)
    await setPaid(server, admin.cookie, paid.id)
    const late = await givenAccount()

    await join(server, late.cookie)

    const [told] = (await list(server, late.cookie)).json().notifications
    expect(told.body).toContain('1 place left')
  })

  it('says nothing when somebody leaves, because an unpaid place was never one of the places', async () => {
    // `left` is the cap less what has been paid for, and leaving only ever removes an
    // unpaid row — so the line cannot move and there is nothing new to say. The decision
    // is recorded here rather than in a route that does not call anything.
    const server = await build()
    await givenBurn(1)
    const admin = await givenAccount(['admin'])
    const paid = await givenAccount()
    await givenComing(paid.id)
    await setPaid(server, admin.cookie, paid.id)
    const late = await givenAccount()
    await join(server, late.cookie)
    const before = (await list(server, late.cookie)).json().notifications.length

    expect((await leave(server, late.cookie)).statusCode).toBe(204)

    expect((await list(server, late.cookie)).json().notifications).toHaveLength(before)
  })

  it('says nothing at all while the burn is nowhere near full', async () => {
    // The passing sibling: warning on every payment would satisfy the two above.
    const server = await build()
    await givenBurn(20)
    const admin = await givenAccount(['admin'])
    const paid = await givenAccount()
    const unpaid = await givenAccount()
    await givenComing(paid.id)
    await givenComing(unpaid.id)

    await setPaid(server, admin.cookie, paid.id)

    expect((await list(server, unpaid.cookie)).json().notifications).toHaveLength(0)
  })

  it('warns nobody again when a payment is re-saved over itself', async () => {
    // The roster's checkbox does this on a double click. It changes no count, so it
    // must say nothing — least of all to *everybody* who has not paid.
    const server = await build()
    await givenBurn(5)
    const admin = await givenAccount(['admin'])
    const paid = await givenAccount()
    const unpaid = await givenAccount()
    await givenComing(paid.id)
    await givenComing(unpaid.id)
    await setPaid(server, admin.cookie, paid.id)
    const first = (await list(server, unpaid.cookie)).json().notifications.length

    await setPaid(server, admin.cookie, paid.id)

    expect((await list(server, unpaid.cookie)).json().notifications).toHaveLength(first)
  })

  it('records a payment once, not on every re-save', async () => {
    const server = await build()
    await givenBurn(20)
    const admin = await givenAccount(['admin'])
    const ada = await givenAccount()
    await givenComing(ada.id)

    await setPaid(server, admin.cookie, ada.id)
    await setPaid(server, admin.cookie, ada.id)

    const theirs = await db().select().from(notification)
    expect(theirs.filter((one) => one.category === 'payment')).toHaveLength(1)
  })

  it('says it is full on the crossing, not again on every payment after it', async () => {
    // Inside the nearly-full window the repetition is a countdown and the number of
    // places left changes each time. Past the cap it carries nothing new.
    const server = await build()
    await givenBurn(1)
    const admin = await givenAccount(['admin'])
    const first = await givenAccount()
    const second = await givenAccount()
    const waiting = await givenAccount()
    await givenComing(first.id)
    await givenComing(second.id)
    await givenComing(waiting.id)

    await setPaid(server, admin.cookie, first.id)
    await setPaid(server, admin.cookie, second.id)

    const theirs = (await list(server, waiting.cookie)).json().notifications
    expect(theirs.filter((one: { category: string }) => one.category === 'waiting_list_pushed')).toHaveLength(
      1,
    )
  })
})

describe('a payment recorded against oneself', () => {
  it('sends no receipt to the admin who recorded it', async () => {
    // Every other category follows "never for your own click", and an admin ticking
    // their own box already knows they ticked it.
    const server = await build()
    await givenBurn(20)
    const admin = await givenAccount(['admin', 'member'])
    await givenComing(admin.id)

    await setPaid(server, admin.cookie, admin.id)

    const theirs = (await list(server, admin.cookie)).json().notifications
    expect(theirs.map((one: { category: string }) => one.category)).not.toContain('payment')
  })

  it('still sends one when the admin records somebody else’s', async () => {
    // The passing sibling: suppressing every receipt would satisfy the test above.
    const server = await build()
    await givenBurn(20)
    const admin = await givenAccount(['admin'])
    const ada = await givenAccount()
    await givenComing(ada.id)

    await setPaid(server, admin.cookie, ada.id)

    const theirs = (await list(server, ada.cookie)).json().notifications
    expect(theirs.map((one: { category: string }) => one.category)).toContain('payment')
  })
})

describe('the unseen count', () => {
  it('counts every unseen one, not only those on the first page', async () => {
    const server = await build()
    const ada = await givenAccount()
    for (let index = 0; index < 55; index += 1) {
      await db()
        .insert(notification)
        .values({
          id: randomUUID(),
          account_id: ada.id,
          category: 'payment',
          body: `number ${index}`,
          link: null,
          created_at: new Date(Date.parse(NOW) + index * 1000).toISOString(),
        })
    }

    const body = (await list(server, ada.cookie)).json()

    expect(body.notifications).toHaveLength(50)
    expect(body.unseen).toBe(55)
  })
})

describe('seeing what a notification points at', () => {
  const shown = (server: FastifyInstance, cookie: string, body: Record<string, string>) =>
    server.inject({ method: 'POST', url: '/api/me/notifications/shown', headers: { cookie }, payload: body })

  const givenNotification = async (
    accountId: string,
    over: { link?: string | null; created_at?: string } = {},
  ) => {
    const id = randomUUID()
    await db()
      .insert(notification)
      .values({
        id,
        account_id: accountId,
        category: 'new_version',
        body: 'A new version is out',
        link: over.link ?? '/changelog',
        created_at: over.created_at ?? NOW,
      })

    return id
  }

  const seenAt = async (id: string) => {
    const [row] = await db().select().from(notification).where(eq(notification.id, id))

    return row?.seen_at ?? null
  }

  it('marks one whose target was shown with data as new as it is', async () => {
    const server = await build()
    const ada = await givenAccount()
    const id = await givenNotification(ada.id)

    const answer = await shown(server, ada.cookie, { link: '/changelog', as_of: NOW })

    expect(answer.statusCode).toBe(200)
    expect(await seenAt(id)).toBe(NOW)
    expect(answer.json().unseen).toBe(0)
  })

  it('leaves one written after the shown data was fetched', async () => {
    const server = await build()
    const ada = await givenAccount()
    const later = new Date(Date.parse(NOW) + 60_000).toISOString()
    const id = await givenNotification(ada.id, { created_at: later })

    await shown(server, ada.cookie, { link: '/changelog', as_of: NOW })

    expect(await seenAt(id)).toBeNull()
  })

  it('marks it once the page has refetched, without a navigation', async () => {
    const server = await build()
    const ada = await givenAccount()
    const later = new Date(Date.parse(NOW) + 60_000).toISOString()
    const id = await givenNotification(ada.id, { created_at: later })

    await shown(server, ada.cookie, { link: '/changelog', as_of: NOW })
    await shown(server, ada.cookie, { link: '/changelog', as_of: later })

    expect(await seenAt(id)).toBe(NOW)
  })

  it('marks only what that page is about, the query being part of the address', async () => {
    const server = await build()
    const ada = await givenAccount()
    const here = await givenNotification(ada.id, { link: '/bring?burn=e-1&item=b-1' })
    const elsewhere = await givenNotification(ada.id, { link: '/bring?burn=e-1&item=b-2' })
    const nowhere = await givenNotification(ada.id, { link: null })

    await shown(server, ada.cookie, { link: '/bring?burn=e-1&item=b-1', as_of: NOW })

    expect(await seenAt(here)).toBe(NOW)
    expect(await seenAt(elsewhere)).toBeNull()
    expect(await seenAt(nowhere)).toBeNull()
  })

  it('leaves somebody else’s notification for the same page alone', async () => {
    const server = await build()
    const ada = await givenAccount()
    const bea = await givenAccount()
    const theirs = await givenNotification(bea.id)

    await shown(server, ada.cookie, { link: '/changelog', as_of: NOW })

    expect(await seenAt(theirs)).toBeNull()
  })

  it('is refused to somebody signed out', async () => {
    const server = await build()

    expect(
      (
        await server.inject({
          method: 'POST',
          url: '/api/me/notifications/shown',
          payload: { link: '/changelog', as_of: NOW },
        })
      ).statusCode,
    ).toBe(401)
  })

  it('refuses a body that is not one, rather than marking everything', async () => {
    const server = await build()
    const ada = await givenAccount()
    const id = await givenNotification(ada.id)

    expect((await shown(server, ada.cookie, { link: '/changelog' })).statusCode).toBe(400)
    expect((await shown(server, ada.cookie, { link: '', as_of: NOW })).statusCode).toBe(400)
    expect((await shown(server, ada.cookie, { as_of: NOW })).statusCode).toBe(400)
    expect(await seenAt(id)).toBeNull()
  })
})

describe('the email channel', () => {
  const setOn = (server: FastifyInstance, cookie: string, on: string[], email: string[]) =>
    server.inject({
      method: 'PUT',
      url: '/api/me/notification-settings',
      headers: { cookie },
      payload: { on, email, digest: 'daily' },
    })

  const ADDRESS = 'ada@example.org'

  const givenAda = async () => {
    const ada = await givenAccount()
    await db().update(account).set({ email: ADDRESS }).where(eq(account.id, ada.id))
    await givenComing(ada.id)
    return ada
  }

  it('is off until somebody asks, so a member with a mail server hears nothing new', async () => {
    // Absence is `false` for this one, unlike the bell — an upgrade must never be
    // what starts posting to somebody's inbox (#30).
    const server = await build()
    await givenMailServer()
    await givenBurn()
    const admin = await givenAccount(['admin'])
    const ada = await givenAda()

    await setPaid(server, admin.cookie, ada.id)

    expect((await list(server, ada.cookie)).json().notifications).toHaveLength(1)
    await settled()
    expect(posted).toHaveLength(0)
  })

  it('posts to somebody who asked, with the same sentence the bell shows', async () => {
    const server = await build()
    await givenMailServer()
    await givenBurn()
    const admin = await givenAccount(['admin'])
    const ada = await givenAda()
    await setOn(server, ada.cookie, ['payment'], ['payment'])

    await setPaid(server, admin.cookie, ada.id)

    await settled()
    expect(posted).toHaveLength(1)
    expect(posted[0]?.to).toBe(ADDRESS)
    const [row] = (await list(server, ada.cookie)).json().notifications
    expect(posted[0]?.subject).toContain(row.body)
  })

  it('posts even with the bell switched off, the two being separate switches', async () => {
    const server = await build()
    await givenMailServer()
    await givenBurn()
    const admin = await givenAccount(['admin'])
    const ada = await givenAda()
    await setOn(server, ada.cookie, [], ['payment'])

    await setPaid(server, admin.cookie, ada.id)

    expect((await list(server, ada.cookie)).json().notifications).toHaveLength(0)
    await settled()
    expect(posted).toHaveLength(1)
  })

  it('posts nothing where no mail server has been set up', async () => {
    const server = await build()
    await givenBurn()
    const admin = await givenAccount(['admin'])
    const ada = await givenAda()
    await setOn(server, ada.cookie, ['payment'], ['payment'])

    await setPaid(server, admin.cookie, ada.id)

    await settled()
    expect(posted).toHaveLength(0)
  })

  it('writes no link at all unless the installation has named its own address', async () => {
    // An email is read outside the app, and this runs from wherever a role was handed
    // out — there is no request to read `Host` from.
    const server = await build()
    await givenMailServer()
    await givenBurn()
    const admin = await givenAccount(['admin'])
    const ada = await givenAda()
    await setOn(server, ada.cookie, ['payment'], ['payment'])

    await setPaid(server, admin.cookie, ada.id)

    await settled()
    expect(posted[0]?.text).not.toContain('http')
  })

  it('writes an absolute one when PUBLIC_ORIGIN says where this is', async () => {
    const server = await build(() => Promise.resolve('sent'), {
      PUBLIC_ORIGIN: 'https://burn.example.org',
    })
    await givenMailServer()
    await givenBurn()
    const admin = await givenAccount(['admin'])
    const ada = await givenAda()
    await setOn(server, ada.cookie, ['payment'], ['payment'])

    await setPaid(server, admin.cookie, ada.id)

    await settled()
    expect(posted[0]?.text).toContain('https://burn.example.org/')
  })

  it('is queued rather than waited on, and posted once the route has answered', async () => {
    // The property this reverses (#356): the send used to be awaited inside the
    // request. Nothing on screen depends on it, and a relay that is down or capped was
    // costing the member the wait. A `send` that does not resolve immediately is what
    // makes the difference visible — left unawaited it would otherwise usually arrive
    // before the assertion anyway.
    handle = createDb({ url: ':memory:' })
    runMigrations(handle)
    const slow: Message[] = []
    const queue = createEmailQueue(() => undefined)
    app = await createApp({
      db: handle.db,
      config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: SECRET }),
      now: () => new Date(NOW),
      deliver: () => Promise.resolve('sent'),
      mintKeys: () => ({ publicKey: 'a-public-key', privateKey: 'a-private-key' }),
      defer: queue.defer,
      send: (_transport, message) =>
        new Promise((resolve) => {
          setTimeout(() => {
            slow.push(message)
            resolve()
          }, 0)
        }),
    })
    await givenMailServer()
    await givenBurn()
    const admin = await givenAccount(['admin'])
    const ada = await givenAda()
    await setOn(app, ada.cookie, ['payment'], ['payment'])

    await setPaid(app, admin.cookie, ada.id)

    expect(slow).toEqual([])

    await queue.drain()

    expect(slow).toHaveLength(1)
  })

  it('still records the row when the mail server refuses', async () => {
    // The write must not fail because a mail server did — the rule push follows.
    handle = createDb({ url: ':memory:' })
    runMigrations(handle)
    app = await createApp({
      db: handle.db,
      config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: SECRET }),
      now: () => new Date(NOW),
      deliver: () => Promise.resolve('sent'),
      mintKeys: () => ({ publicKey: 'a-public-key', privateKey: 'a-private-key' }),
      send: () => Promise.reject(new Error('connect ECONNREFUSED')),
    })
    await givenMailServer()
    await givenBurn()
    const admin = await givenAccount(['admin'])
    const ada = await givenAda()
    await setOn(app, ada.cookie, ['payment'], ['payment'])

    const paid = await setPaid(app, admin.cookie, ada.id)

    expect(paid.statusCode).toBe(200)
    expect((await list(app, ada.cookie)).json().notifications).toHaveLength(1)
  })
})

describe('the log an organiser scans', () => {
  const log = (server: FastifyInstance, cookie?: string) =>
    server.inject({
      method: 'GET',
      url: '/api/admin/notification-log',
      headers: cookie === undefined ? {} : { cookie },
    })

  it('says what went out, to how many, and how many devices took it', async () => {
    const server = await build()
    await givenBurn()
    const admin = await givenAccount(['admin'])
    const ada = await givenAccount()
    await givenComing(ada.id)
    await givenSubscribed(ada.id)

    await setPaid(server, admin.cookie, ada.id)

    expect((await log(server, admin.cookie)).json().entries).toMatchObject([
      { category: 'payment', told: 1, suppressed: 0, accepted: 1, failed: 0, gone: 0 },
    ])
  })

  it('counts the devices that were not there to take it', async () => {
    const server = await build(() => Promise.resolve('gone'))
    await givenBurn()
    const admin = await givenAccount(['admin'])
    const ada = await givenAccount()
    await givenComing(ada.id)
    await givenSubscribed(ada.id)

    await setPaid(server, admin.cookie, ada.id)

    expect((await log(server, admin.cookie)).json().entries[0]).toMatchObject({ accepted: 0, gone: 1 })
  })

  it("is nobody but an admin's", async () => {
    const server = await build()
    const member = await givenAccount()

    expect((await log(server, member.cookie)).statusCode).toBe(403)
  })

  it('refuses somebody who is not signed in', async () => {
    const server = await build()

    expect((await log(server)).statusCode).toBe(401)
  })
})

describe('what one line in the log covers', () => {
  const log = (server: FastifyInstance, cookie: string) =>
    server.inject({ method: 'GET', url: '/api/admin/notification-log', headers: { cookie } })

  it('is a whole waiting-list warning, however many have not paid', async () => {
    const server = await build()
    await givenBurn(5)
    const admin = await givenAccount(['admin'])
    const paid = await givenAccount()
    for (const one of [paid, await givenAccount(), await givenAccount()]) await givenComing(one.id)

    await setPaid(server, admin.cookie, paid.id)

    const said = (await log(server, admin.cookie)).json().entries
    expect(said.filter((one: { category: string }) => one.category === 'waiting_list_near')).toHaveLength(1)
  })

  it('is a whole burn-wide comment, not one line per person hearing it', async () => {
    const server = await build()
    await givenBurn(10)
    const admin = await givenAccount(['admin'])
    const ada = await givenAccount()
    const bo = await givenAccount()
    const cyd = await givenAccount()
    for (const one of [admin, ada, bo, cyd]) await givenComing(one.id)
    const item = await server.inject({
      method: 'POST',
      url: `/api/events/${BURN}/bring`,
      headers: { cookie: ada.cookie },
      payload: { title: 'A gazebo' },
    })

    await server.inject({
      method: 'POST',
      url: `/api/threads/${item.json().item.thread_id}/comments`,
      headers: { cookie: bo.cookie },
      payload: { body: 'Here is a thought' },
    })

    const said = (await log(server, admin.cookie)).json().entries
    expect(said.filter((one: { body: string }) => one.body.includes('said something'))).toHaveLength(2)
  })
})
