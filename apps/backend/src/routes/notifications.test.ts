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

const givenComing = async (accountId: string, paid = false) => {
  await db()
    .insert(attendance)
    .values({
      id: randomUUID(),
      event_id: BURN,
      account_id: accountId,
      joined_at: NOW,
      payment_status: paid ? 'paid' : 'unpaid',
    })
}

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
    'mentioned',
    'application',
    'application_news',
  ]

  const setOn = (server: FastifyInstance, cookie: string, on: string[], email: string[] = []) =>
    server.inject({
      method: 'PUT',
      url: '/api/me/notification-settings',
      headers: { cookie },
      payload: { on, email },
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

  it('defaults to what happens to you, with no row seeded for a new account', async () => {
    const server = await build()
    const ada = await givenAccount()

    const settings = await server.inject({
      method: 'GET',
      url: '/api/me/notification-settings',
      headers: { cookie: ada.cookie },
    })

    expect(settings.json().on).toEqual(DEFAULTS)
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

describe('the email channel', () => {
  const setOn = (server: FastifyInstance, cookie: string, on: string[], email: string[]) =>
    server.inject({
      method: 'PUT',
      url: '/api/me/notification-settings',
      headers: { cookie },
      payload: { on, email },
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
