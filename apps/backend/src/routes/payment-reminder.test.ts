import type { FastifyInstance, LightMyRequestResponse } from 'fastify'

import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'
import type { Message } from '../mail/mail.ts'
import type { EmailQueue } from '../mail/queue.ts'

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
  notificationSetting,
} from '../db/schema.ts'
import { createEmailQueue } from '../mail/queue.ts'

const SECRET = 's'.repeat(40)
const NOW = '2026-07-02T00:00:00.000Z'

let handle: DbHandle | undefined
let app: FastifyInstance | undefined
let emails: EmailQueue | undefined
const posted: Message[] = []

afterEach(async () => {
  await app?.close()
  handle?.close()
  app = undefined
  handle = undefined
})

const build = async () => {
  posted.length = 0
  const queue = createEmailQueue(() => undefined)
  emails = queue
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: SECRET }),
    now: () => new Date(NOW),
    defer: queue.defer,
    send: (_transport, message) => {
      posted.push(message)
      return Promise.resolve()
    },
  })
  return app
}

const settled = async () => await emails?.drain()

const db = () => {
  const found = handle?.db
  if (found === undefined) throw new Error('build() first')
  return found
}

const cookieFor = (id: string) => {
  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return `${SESSION_COOKIE}=${sessions.issue(id)}`
}

const givenAccount = async (name: string, roles: ('admin' | 'member')[] = ['member']) => {
  const id = randomUUID()
  const email = `${name.toLowerCase()}@example.org`
  await db().insert(account).values({ id, email, password_hash: null, name, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  return { id, email, cookie: cookieFor(id) }
}

const givenEvent = async ({
  cap = 42,
  end_date = '2026-08-05',
}: { cap?: number; end_date?: string } = {}) => {
  const id = randomUUID()
  await db()
    .insert(event)
    .values({
      id,
      name: 'Summer burn',
      slug: `burn-${id.slice(0, 8)}`,
      start_date: '2026-06-01',
      end_date,
      member_cap: cap,
      created_at: NOW,
    })
  return id
}

const givenComing = async (eventId: string, accountId: string, joined_at: string, paid = false) => {
  await db()
    .insert(attendance)
    .values({
      id: randomUUID(),
      event_id: eventId,
      account_id: accountId,
      joined_at,
      payment_status: paid ? 'paid' : 'unpaid',
      payment_date: paid ? '2026-06-30' : null,
    })
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

const REMINDER = {
  subject: 'Your place at Summer burn is not paid for yet',
  body: 'Please pay.\n\nThank you.',
}

const remind = (
  server: FastifyInstance,
  cookie: string,
  eventId: string,
  payload: Record<string, unknown> = REMINDER,
): Promise<LightMyRequestResponse> =>
  server.inject({
    method: 'POST',
    url: `/api/admin/events/${eventId}/payment-reminder`,
    headers: { cookie, host: 'burn.example.org' },
    payload,
  })

const bellFor = async (accountId: string) =>
  await db()
    .select({ category: notification.category, body: notification.body, link: notification.link })
    .from(notification)
    .where(eq(notification.account_id, accountId))

describe('reminding everybody who has not paid', () => {
  it('rings the bell of every unpaid attendee, the waiting list included, and nobody else', async () => {
    const server = await build()
    const admin = await givenAccount('Ada', ['admin', 'member'])
    const placed = await givenAccount('Bea')
    const waiting = await givenAccount('Cy')
    const paid = await givenAccount('Dee')
    const burn = await givenEvent({ cap: 2 })
    await givenComing(burn, paid.id, '2026-06-01T00:00:00Z', true)
    await givenComing(burn, placed.id, '2026-06-02T00:00:00Z')
    await givenComing(burn, waiting.id, '2026-06-03T00:00:00Z')
    await givenComing(burn, admin.id, '2026-06-04T00:00:00Z')

    const sent = await remind(server, admin.cookie, burn)

    expect(sent.statusCode).toBe(200)
    expect(sent.json()).toEqual({ told: 2 })
    for (const who of [placed, waiting]) {
      expect(await bellFor(who.id)).toEqual([
        { category: 'payment_reminder', body: REMINDER.subject, link: `/members?burn=${burn}` },
      ])
    }
    expect(await bellFor(paid.id)).toEqual([])
    expect(await bellFor(admin.id)).toEqual([])
  })

  it('reaches nobody on another burn', async () => {
    const server = await build()
    const admin = await givenAccount('Ada', ['admin'])
    const elsewhere = await givenAccount('Bea')
    const burn = await givenEvent()
    const other = await givenEvent()
    await givenComing(other, elsewhere.id, '2026-06-02T00:00:00Z')

    const sent = await remind(server, admin.cookie, burn)

    expect(sent.json()).toEqual({ told: 0 })
    expect(await bellFor(elsewhere.id)).toEqual([])
  })

  it('posts the organisers’ words to somebody who switched this category’s email off', async () => {
    const server = await build()
    await givenMailServer()
    const admin = await givenAccount('Ada', ['admin'])
    const bea = await givenAccount('Bea')
    const burn = await givenEvent()
    await givenComing(burn, bea.id, '2026-06-02T00:00:00Z')
    await db()
      .insert(notificationSetting)
      .values({ account_id: bea.id, category: 'payment_reminder', enabled: false, email: false })

    await remind(server, admin.cookie, burn)
    await settled()

    expect(await bellFor(bea.id)).toHaveLength(1)
    expect(posted).toHaveLength(1)
    expect(posted[0]?.to).toBe(bea.email)
    expect(posted[0]?.subject).toBe(REMINDER.subject)
    expect(posted[0]?.text).toContain('Hello Bea,')
    expect(posted[0]?.text).toContain('Thank you.')
    expect(posted[0]?.text).toContain(`http://burn.example.org/members?burn=${burn}`)
  })

  it('posts nothing where no mail server is set up, the bell still ringing', async () => {
    const server = await build()
    const admin = await givenAccount('Ada', ['admin'])
    const bea = await givenAccount('Bea')
    const burn = await givenEvent()
    await givenComing(burn, bea.id, '2026-06-02T00:00:00Z')

    await remind(server, admin.cookie, burn)
    await settled()

    expect(await bellFor(bea.id)).toHaveLength(1)
    expect(posted).toEqual([])
  })

  it('answers none told where everybody has paid', async () => {
    const server = await build()
    const admin = await givenAccount('Ada', ['admin'])
    const bea = await givenAccount('Bea')
    const burn = await givenEvent()
    await givenComing(burn, bea.id, '2026-06-02T00:00:00Z', true)

    const sent = await remind(server, admin.cookie, burn)

    expect(sent.statusCode).toBe(200)
    expect(sent.json()).toEqual({ told: 0 })
  })

  it('is refused to a member who is not an admin', async () => {
    const server = await build()
    const member = await givenAccount('Bea')
    const burn = await givenEvent()
    await givenComing(burn, member.id, '2026-06-02T00:00:00Z')

    const sent = await remind(server, member.cookie, burn)

    expect(sent.statusCode).toBe(403)
    expect(await bellFor(member.id)).toEqual([])
  })

  it('refuses a blank subject or body', async () => {
    const server = await build()
    const admin = await givenAccount('Ada', ['admin'])
    const burn = await givenEvent()

    expect((await remind(server, admin.cookie, burn, { ...REMINDER, subject: '   ' })).statusCode).toBe(400)
    expect((await remind(server, admin.cookie, burn, { ...REMINDER, body: '' })).statusCode).toBe(400)
  })

  it('refuses a burn that does not exist', async () => {
    const server = await build()
    const admin = await givenAccount('Ada', ['admin'])

    expect((await remind(server, admin.cookie, randomUUID())).statusCode).toBe(404)
  })

  it('refuses a burn that has ended', async () => {
    const server = await build()
    const admin = await givenAccount('Ada', ['admin'])
    const bea = await givenAccount('Bea')
    const burn = await givenEvent({ end_date: '2026-07-01' })
    await givenComing(burn, bea.id, '2026-06-02T00:00:00Z')

    expect((await remind(server, admin.cookie, burn)).statusCode).toBe(404)
    expect(await bellFor(bea.id)).toEqual([])
  })

  it('takes a burn ending today, which has not ended yet', async () => {
    const server = await build()
    const admin = await givenAccount('Ada', ['admin'])
    const bea = await givenAccount('Bea')
    const burn = await givenEvent({ end_date: '2026-07-02' })
    await givenComing(burn, bea.id, '2026-06-02T00:00:00Z')

    expect((await remind(server, admin.cookie, burn)).json()).toEqual({ told: 1 })
  })
})
