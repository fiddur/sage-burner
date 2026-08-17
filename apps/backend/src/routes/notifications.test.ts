import type { FastifyInstance } from 'fastify'

import { notificationCategories } from '@sage-burner/shared'
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

const client = () => {
  const found = handle?.client
  if (found === undefined) throw new Error('build() first')
  return found
}

const posted: Message[] = []

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

const givenBurn = async (cap = 3, dates = { start_date: '2026-08-01', end_date: '2026-08-03' }) => {
  await db()
    .insert(event)
    .values({
      id: BURN,
      name: 'Summer burn',
      slug: 'summer',
      ...dates,
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

const bodies = async (server: FastifyInstance, cookie: string): Promise<string[]> =>
  (await list(server, cookie)).json().notifications.map((one: { body: string }) => one.body)

const setPaid = (server: FastifyInstance, cookie: string, accountId: string) =>
  server.inject({
    method: 'PATCH',
    url: `/api/admin/events/${BURN}/attendance/${accountId}/payment`,
    headers: { cookie },
    payload: { payment_status: 'paid' },
  })

describe('the bell', () => {
  it('turns nobody away for having no role', async () => {
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

describe('taking one off your own list', () => {
  const givenOne = async (server: Awaited<ReturnType<typeof build>>) => {
    await givenBurn()
    const admin = await givenAccount(['admin'])
    const ada = await givenAccount()
    await givenComing(ada.id)
    await setPaid(server, admin.cookie, ada.id)

    const [only] = (await list(server, ada.cookie)).json().notifications

    return { ada, only }
  }

  const drop = (server: Awaited<ReturnType<typeof build>>, cookie: string | undefined, id: string) =>
    server.inject({
      method: 'DELETE',
      url: `/api/me/notifications/${id}`,
      ...(cookie === undefined ? {} : { headers: { cookie } }),
    })

  it('removes it, and settles the count it was part of', async () => {
    const server = await build()
    const { ada, only } = await givenOne(server)

    const gone = await drop(server, ada.cookie, only.id)

    expect(gone.statusCode).toBe(200)
    expect(gone.json().notifications).toHaveLength(0)
    expect(gone.json().unseen).toBe(0)
    expect((await list(server, ada.cookie)).json().notifications).toHaveLength(0)
  })

  it('refuses to take somebody else’s off, and leaves it where it was', async () => {
    const server = await build()
    const { ada, only } = await givenOne(server)
    const bea = await givenAccount()

    expect((await drop(server, bea.cookie, only.id)).statusCode).toBe(404)
    expect((await list(server, ada.cookie)).json().notifications).toHaveLength(1)
  })

  it('refuses somebody who is not signed in', async () => {
    const server = await build()
    const { only } = await givenOne(server)

    expect((await drop(server, undefined, only.id)).statusCode).toBe(401)
  })

  it('answers 404 for one that is already gone', async () => {
    const server = await build()
    const { ada, only } = await givenOne(server)

    await drop(server, ada.cookie, only.id)

    expect((await drop(server, ada.cookie, only.id)).statusCode).toBe(404)
  })
})

describe('what somebody has switched on', () => {
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
    'meal_comment',
    'hearted',
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

  const mute = (server: FastifyInstance, cookie: string, muted: string[]) =>
    setOn(
      server,
      cookie,
      DEFAULTS.filter((category) => !muted.includes(category)),
    )

  it('records nothing at all for a category switched off', async () => {
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
      expect(theirs[0].body).toContain('1 place left')
    }
  })

  it('says how many are left, and says one in the singular', async () => {
    const server = await build()
    await givenBurn(3)
    const admin = await givenAccount(['admin'])
    const paid = await givenAccount()
    const unpaid = await givenAccount()
    await givenComing(paid.id)
    await givenComing(unpaid.id)

    await setPaid(server, admin.cookie, paid.id)

    const [told] = (await list(server, unpaid.cookie)).json().notifications
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
    expect(told.body).toContain('2 places left, and they go to whoever pays')
  })

  it('counts the places nobody is standing in, not the ones nobody has paid for (#726)', async () => {
    const server = await build()
    await givenBurn(3)
    const admin = await givenAccount(['admin'])
    const paid = await givenAccount()
    const unpaid = await givenAccount()
    const alsoUnpaid = await givenAccount()
    for (const [at, who] of [paid, unpaid, alsoUnpaid].entries()) {
      await givenComing(who.id, false, joinedAt(at))
    }

    await setPaid(server, admin.cookie, paid.id)

    const said = await bodies(server, unpaid.cookie)
    expect(said).toContainEqual(expect.stringContaining('You are in one for now'))
    expect(said).not.toContainEqual(expect.stringContaining('2 places left'))
  })

  it('tells the holder of an unpaid place that they hold it, not to go and win one (#726)', async () => {
    const server = await build()
    await givenBurn(1)
    const admin = await givenAccount(['admin'])
    const paid = await givenAccount()
    const unpaid = await givenAccount()
    await givenComing(paid.id)
    await givenComing(unpaid.id, false, joinedAt(1))
    await setPaid(server, admin.cookie, paid.id)

    const gone = await server.inject({
      method: 'DELETE',
      url: `/api/admin/events/${BURN}/attendance/${paid.id}`,
      headers: { cookie: admin.cookie },
    })
    expect(gone.statusCode).toBe(204)

    const said = await bodies(server, unpaid.cookie)
    expect(said).toContainEqual(expect.stringContaining('You are in one for now'))
    expect(said).not.toContainEqual(expect.stringContaining('place left'))
  })

  it('lifts somebody off the waiting list when an unpaid member leaves (#726)', async () => {
    const server = await build()
    await givenBurn(2)
    const admin = await givenAccount(['admin'])
    const paid = await givenAccount()
    const going = await givenAccount()
    const behind = await givenAccount()
    for (const [at, who] of [paid, going, behind].entries()) {
      await givenComing(who.id, false, joinedAt(at))
    }
    await setPaid(server, admin.cookie, paid.id)
    expect(await bodies(server, behind.cookie)).toContainEqual(
      expect.stringContaining('you are on the waiting list'),
    )

    expect((await leave(server, going.cookie)).statusCode).toBe(204)

    expect(await bodies(server, behind.cookie)).toContainEqual(
      expect.stringContaining('You are in one for now'),
    )
  })

  it('does the same when an admin removes an unpaid member, a headcount being a headcount', async () => {
    const server = await build()
    await givenBurn(2)
    const admin = await givenAccount(['admin'])
    const paid = await givenAccount()
    const going = await givenAccount()
    const behind = await givenAccount()
    for (const [at, who] of [paid, going, behind].entries()) {
      await givenComing(who.id, false, joinedAt(at))
    }
    await setPaid(server, admin.cookie, paid.id)

    const gone = await server.inject({
      method: 'DELETE',
      url: `/api/admin/events/${BURN}/attendance/${going.id}`,
      headers: { cookie: admin.cookie },
    })
    expect(gone.statusCode).toBe(204)

    expect(await bodies(server, behind.cookie)).toContainEqual(
      expect.stringContaining('You are in one for now'),
    )
  })

  it('does the same when a place is handed over, the giver’s row going with it', async () => {
    const server = await build()
    await givenBurn(2)
    const admin = await givenAccount(['admin'])
    const giver = await givenAccount()
    const taker = await givenAccount()
    const behind = await givenAccount()
    for (const [at, who] of [giver, taker, behind].entries()) {
      await givenComing(who.id, false, joinedAt(at))
    }
    await setPaid(server, admin.cookie, giver.id)
    expect(await bodies(server, behind.cookie)).toContainEqual(
      expect.stringContaining('you are on the waiting list'),
    )

    const handed = await server.inject({
      method: 'POST',
      url: `/api/events/${BURN}/attendance/me/transfer`,
      headers: { cookie: giver.cookie },
      payload: { to_account_id: taker.id },
    })
    expect(handed.statusCode).toBe(204)

    expect(await bodies(server, behind.cookie)).toContainEqual(
      expect.stringContaining('You are in one for now'),
    )
  })

  it('agrees with the roster about who holds a place and who waits (#726)', async () => {
    const server = await build()
    await givenBurn(1)
    const admin = await givenAccount(['admin'])
    const holder = await givenAccount()
    const behind = await givenAccount()
    await givenComing(holder.id, false, joinedAt(0))
    await givenComing(behind.id, false, joinedAt(1))
    const paid = await givenAccount()
    await givenComing(paid.id, false, joinedAt(2))

    await setPaid(server, admin.cookie, paid.id)

    const gone = await server.inject({
      method: 'DELETE',
      url: `/api/admin/events/${BURN}/attendance/${paid.id}`,
      headers: { cookie: admin.cookie },
    })
    expect(gone.statusCode).toBe(204)

    const roster = await server.inject({
      method: 'GET',
      url: `/api/events/${BURN}/members`,
      headers: { cookie: admin.cookie },
    })
    const held = roster
      .json()
      .entries.filter((one: { waiting: boolean }) => !one.waiting)
      .map((one: { account_id: string }) => one.account_id)

    expect(held).toEqual([holder.id])
    expect(await bodies(server, holder.cookie)).toContainEqual(
      expect.stringContaining('You are in one for now'),
    )
    expect(await bodies(server, behind.cookie)).toContainEqual(
      expect.stringContaining('you are on the waiting list'),
    )
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

  it('moves the line when an admin takes a paid place away', async () => {
    const server = await build()
    await givenBurn(1)
    const admin = await givenAccount(['admin'])
    const paid = await givenAccount()
    const waiting = await givenAccount()
    await givenComing(paid.id)
    await givenComing(waiting.id, false, joinedAt(1))
    await setPaid(server, admin.cookie, paid.id)

    const gone = await server.inject({
      method: 'DELETE',
      url: `/api/admin/events/${BURN}/attendance/${paid.id}`,
      headers: { cookie: admin.cookie },
    })
    expect(gone.statusCode).toBe(204)

    const theirs = (await list(server, waiting.cookie)).json().notifications
    expect(theirs.map((one: { category: string }) => one.category)).toContain('waiting_list_near')
  })

  it('moves the line when a payment is un-recorded', async () => {
    const server = await build()
    await givenBurn(1)
    const admin = await givenAccount(['admin'])
    const first = await givenAccount()
    const second = await givenAccount()
    await givenComing(first.id, false, joinedAt(1))
    await givenComing(second.id, false, joinedAt(0))
    await setPaid(server, admin.cookie, first.id)

    const undone = await server.inject({
      method: 'PATCH',
      url: `/api/admin/events/${BURN}/attendance/${first.id}/payment`,
      headers: { cookie: admin.cookie },
      payload: { payment_status: 'unpaid' },
    })
    expect(undone.statusCode).toBe(200)

    const theirs = (await list(server, second.cookie)).json().notifications
    expect(theirs.map((one: { category: string }) => one.category)).toContain('waiting_list_near')
    expect(theirs[0].body).toContain('You are in one for now')
  })

  it('says nothing about the waiting list of a burn that has ended', async () => {
    const server = await build()
    await givenBurn(1, { start_date: '2025-08-01', end_date: '2025-08-03' })
    const admin = await givenAccount(['admin'])
    const paid = await givenAccount()
    await givenComing(paid.id, true)
    const added = await givenAccount()

    const put = await server.inject({
      method: 'POST',
      url: `/api/admin/events/${BURN}/attendance`,
      headers: { cookie: admin.cookie },
      payload: { account_id: added.id },
    })
    expect(put.statusCode).toBe(201)

    expect((await list(server, added.cookie)).json().notifications).toEqual([])
  })

  it('still says it for a burn that has not ended, which is the case that has to keep working', async () => {
    const server = await build()
    await givenBurn(1)
    const admin = await givenAccount(['admin'])
    const paid = await givenAccount()
    await givenComing(paid.id, true)
    const added = await givenAccount()

    await server.inject({
      method: 'POST',
      url: `/api/admin/events/${BURN}/attendance`,
      headers: { cookie: admin.cookie },
      payload: { account_id: added.id },
    })

    const theirs = (await list(server, added.cookie)).json().notifications
    expect(theirs.map((one: { category: string }) => one.category)).toEqual(['waiting_list_pushed'])
  })

  it('says nothing to somebody who joins a burn with room in it', async () => {
    const server = await build()
    await givenBurn(20)
    const joiner = await givenAccount()

    expect((await join(server, joiner.cookie)).statusCode).toBe(201)

    expect((await list(server, joiner.cookie)).json().notifications).toEqual([])
  })

  it('does not tell the others again when somebody else joins', async () => {
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
    await givenBurn(3)
    const admin = await givenAccount(['admin'])
    const paid = await givenAccount()
    await givenComing(paid.id)
    await setPaid(server, admin.cookie, paid.id)
    const late = await givenAccount()

    await join(server, late.cookie)

    const [told] = (await list(server, late.cookie)).json().notifications
    expect(told.body).toContain('1 place left')
  })

  it('repeats nothing to somebody whose own sentence has not changed when another leaves', async () => {
    const server = await build()
    await givenBurn(1)
    const admin = await givenAccount(['admin'])
    const paid = await givenAccount()
    await givenComing(paid.id)
    await setPaid(server, admin.cookie, paid.id)
    const staying = await givenAccount()
    await join(server, staying.cookie)
    const late = await givenAccount()
    await join(server, late.cookie)
    const before = (await list(server, staying.cookie)).json().notifications.length

    expect((await leave(server, late.cookie)).statusCode).toBe(204)

    expect((await list(server, staying.cookie)).json().notifications).toHaveLength(before)
  })

  it('says nothing at all while the burn is nowhere near full', async () => {
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
    const server = await build()
    await givenBurn(20)
    const admin = await givenAccount(['admin', 'member'])
    await givenComing(admin.id)

    await setPaid(server, admin.cookie, admin.id)

    const theirs = (await list(server, admin.cookie)).json().notifications
    expect(theirs.map((one: { category: string }) => one.category)).not.toContain('payment')
  })

  it('still sends one when the admin records somebody else’s', async () => {
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

describe('the vocabulary the database will accept', () => {
  const insertable = (table: 'notification' | 'notification_setting', category: string): boolean => {
    try {
      if (table === 'notification') {
        client()
          .prepare('insert into notification (id, account_id, category, body, created_at) values (?,?,?,?,?)')
          .run(randomUUID(), CATEGORY_CHECK_ACCOUNT, category, 'a line', NOW)
      } else {
        client()
          .prepare('insert into notification_setting (account_id, category, enabled, email) values (?,?,?,?)')
          .run(CATEGORY_CHECK_ACCOUNT, category, 1, 0)
      }

      return true
    } catch {
      return false
    }
  }

  const CATEGORY_CHECK_ACCOUNT = 'a0000000-0000-4000-8000-0000000000ff'

  const givenSomebody = async () => {
    await db().insert(account).values({
      id: CATEGORY_CHECK_ACCOUNT,
      email: 'checks@example.org',
      password_hash: null,
      created_at: NOW,
    })
  }

  it('takes every category the app knows about, on both tables', async () => {
    await build()
    await givenSomebody()

    const refused = notificationCategories.filter(
      (category) => !insertable('notification', category) || !insertable('notification_setting', category),
    )

    expect(refused).toEqual([])
  })

  it('refuses one it has never heard of, so the CHECK is doing something', async () => {
    await build()
    await givenSomebody()

    expect(insertable('notification', 'not_a_category')).toBe(false)
    expect(insertable('notification_setting', 'not_a_category')).toBe(false)
  })
})
