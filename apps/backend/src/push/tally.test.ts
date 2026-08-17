import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'
import type { EmailChannel, PushTrouble, Told } from './notify.ts'
import type { Delivery, PushDeps } from './push.ts'

import { createDb, runMigrations } from '../db/index.ts'
import {
  account,
  attendance,
  event,
  notification,
  notificationBatch,
  notificationSetting,
  pushSubscription,
} from '../db/schema.ts'
import { createEmailQueue } from '../mail/queue.ts'
import { notificationBatches, oneBatch, recordAndPush, RETENTION_DAYS, tellAttendees } from './notify.ts'

const NOW = '2026-08-03T00:00:00.000Z'
const BURN = '9f1c2f2a-6f1a-4a2e-9c6d-2f0a1b3c4d5e'

let handle: DbHandle | undefined
let clock = new Date(NOW)

afterEach(() => {
  handle?.close()
  handle = undefined
  clock = new Date(NOW)
})

const db = () => {
  const found = handle?.db
  if (found === undefined) throw new Error('build() first')

  return found
}

const build = (deliver: Delivery = () => Promise.resolve('sent')): PushDeps => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)

  return {
    db: handle.db,
    deliver,
    now: () => clock,
    mintKeys: () => ({ publicKey: 'pub', privateKey: 'priv' }),
  }
}

const givenAccount = async (over: { bell?: boolean; email?: boolean } = {}): Promise<string> => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, created_at: NOW })
  await db()
    .insert(notificationSetting)
    .values({
      account_id: id,
      category: 'dream_offered',
      enabled: over.bell ?? true,
      email: over.email ?? false,
    })

  return id
}

const givenDevice = async (accountId: string, endpoint: string) => {
  await db()
    .insert(pushSubscription)
    .values({ id: randomUUID(), account_id: accountId, endpoint, p256dh: 'p', auth: 'a', created_at: NOW })
}

const givenBurn = async () => {
  await db().insert(event).values({
    id: BURN,
    name: 'Summer burn',
    slug: 'summer-burn',
    start_date: '2026-08-01',
    end_date: '2026-08-05',
    member_cap: 42,
    created_at: NOW,
  })
}

const TOLD: Told = { category: 'dream_offered', body: 'Ada offered a dream', link: '/dreams' }

const telling = (deps: PushDeps, log: (trouble: PushTrouble) => void = () => undefined) =>
  recordAndPush(deps, () => clock, log)

const emailing = (deps: PushDeps, post: EmailChannel) => {
  const queue = createEmailQueue(() => undefined)

  return {
    notify: recordAndPush(
      deps,
      () => clock,
      () => undefined,
      { post, defer: queue.defer },
    ),
    queue,
  }
}

const rows = async () => await db().select().from(notificationBatch)

describe('the record of a notification going out', () => {
  it('writes one row for it, carrying what was said', async () => {
    const deps = build()
    const accountId = await givenAccount()

    await telling(deps)(accountId, TOLD)

    expect(await rows()).toMatchObject([
      { category: 'dream_offered', body: 'Ada offered a dream', link: '/dreams', created_at: NOW },
    ])
  })

  it('counts a fan-out as one notification rather than one per person', async () => {
    const deps = build()
    await givenBurn()
    for (let made = 0; made < 3; made += 1) {
      await db()
        .insert(attendance)
        .values({ id: randomUUID(), event_id: BURN, account_id: await givenAccount(), joined_at: NOW })
    }

    await tellAttendees(deps.db, telling(deps), BURN, TOLD)

    expect(await rows()).toMatchObject([{ told: 3, suppressed: 0 }])
  })

  it('counts a loop that is not a fan-out helper as one too, given one batch to share', async () => {
    const deps = build()
    const told = oneBatch(TOLD)
    const telling_ = telling(deps)
    for (let made = 0; made < 3; made += 1) await telling_(await givenAccount(), told)

    expect(await rows()).toMatchObject([{ told: 3 }])
  })

  it('counts somebody who has the category switched off, which nothing else records', async () => {
    const deps = build()
    const accountId = await givenAccount({ bell: false })

    await telling(deps)(accountId, TOLD)

    expect(await rows()).toMatchObject([{ told: 0, suppressed: 1 }])
    expect(await db().select().from(notification)).toEqual([])
  })

  it('counts the devices the push service took, and the ones it says are gone', async () => {
    const deps = build((subscription) =>
      Promise.resolve(subscription.endpoint === 'https://push.example/dead' ? 'gone' : 'sent'),
    )
    const accountId = await givenAccount()
    await givenDevice(accountId, 'https://push.example/live')
    await givenDevice(accountId, 'https://push.example/dead')

    await telling(deps)(accountId, TOLD)

    expect(await rows()).toMatchObject([{ accepted: 1, gone: 1, failed: 0 }])
  })

  it('counts a device the push service refused as failed, not as accepted', async () => {
    const deps = build(() => Promise.resolve('failed'))
    const accountId = await givenAccount()
    await givenDevice(accountId, 'https://push.example/sulking')

    await telling(deps)(accountId, TOLD)

    expect(await rows()).toMatchObject([{ accepted: 0, failed: 1, gone: 0 }])
  })

  it('counts the email leg where a mail server took it', async () => {
    const deps = build()
    const accountId = await givenAccount({ email: true })

    const email = emailing(deps, () => Promise.resolve({ sent: true, reason: null }))

    await email.notify(accountId, TOLD)
    await email.queue.drain()

    expect(await rows()).toMatchObject([{ emailed: 1 }])
  })

  it('counts none where the mail server refused it', async () => {
    const deps = build()
    const accountId = await givenAccount({ email: true })

    const email = emailing(deps, () => Promise.resolve({ sent: false, reason: '550 nope' }))

    await email.notify(accountId, TOLD)
    await email.queue.drain()

    expect(await rows()).toMatchObject([{ emailed: 0 }])
  })

  it('counts none where the installation has no mail server, nothing being attempted', async () => {
    const deps = build()
    const accountId = await givenAccount({ email: true })

    const email = emailing(deps, () => Promise.resolve(undefined))

    await email.notify(accountId, TOLD)
    await email.queue.drain()

    expect(await rows()).toMatchObject([{ emailed: 0 }])
  })

  it('counts no email where nobody asked for one', async () => {
    const deps = build()
    const accountId = await givenAccount()

    const email = emailing(deps, () => Promise.resolve({ sent: true, reason: null }))

    await email.notify(accountId, TOLD)
    await email.queue.drain()

    expect(await rows()).toMatchObject([{ emailed: 0 }])
  })

  it('drops a record older than the retention, when the next notification goes out', async () => {
    const deps = build()
    const accountId = await givenAccount()
    await telling(deps)(accountId, TOLD)
    clock = new Date(Date.parse(NOW) + (RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000)

    await telling(deps)(accountId, TOLD)

    expect(await rows()).toHaveLength(1)
  })

  it('keeps one from the day before the retention runs out', async () => {
    const deps = build()
    const accountId = await givenAccount()
    await telling(deps)(accountId, TOLD)
    clock = new Date(Date.parse(NOW) + (RETENTION_DAYS - 1) * 24 * 60 * 60 * 1000)

    await telling(deps)(accountId, TOLD)

    expect(await rows()).toHaveLength(2)
  })

  it('answers the newest first, which is the order an organiser reads them in', async () => {
    const deps = build()
    const accountId = await givenAccount()
    await telling(deps)(accountId, { ...TOLD, body: 'the older one' })
    clock = new Date(Date.parse(NOW) + 60_000)
    await telling(deps)(accountId, { ...TOLD, body: 'the newer one' })

    expect((await notificationBatches(db(), 10)).map((row) => row.body)).toEqual([
      'the newer one',
      'the older one',
    ])
  })

  it('answers no more than it was asked for', async () => {
    const deps = build()
    const accountId = await givenAccount()
    for (let made = 0; made < 3; made += 1) {
      clock = new Date(Date.parse(NOW) + made * 60_000)
      await telling(deps)(accountId, TOLD)
    }

    expect(await notificationBatches(db(), 2)).toHaveLength(2)
  })

  it('leaves the bell rows alone, being a second record and not a replacement', async () => {
    const deps = build()
    const accountId = await givenAccount()

    await telling(deps)(accountId, TOLD)

    const bell = await db().select().from(notification).where(eq(notification.account_id, accountId))
    expect(bell.map((row) => row.body)).toEqual([TOLD.body])
  })
})

describe('the line written when a push goes wrong', () => {
  it('says who it was for and what it was about, which is what makes it worth reading', async () => {
    const deps = build(() => Promise.resolve('failed'))
    const accountId = await givenAccount()
    await givenDevice(accountId, 'https://push.example/sulking')
    const trouble: PushTrouble[] = []

    await telling(deps, (one) => trouble.push(one))(accountId, TOLD)

    expect(trouble).toEqual([
      { account_id: accountId, category: 'dream_offered', sent: 0, failed: 1, gone: 0 },
    ])
  })

  it('says nothing when every device took it', async () => {
    const deps = build()
    const accountId = await givenAccount()
    await givenDevice(accountId, 'https://push.example/live')
    const trouble: PushTrouble[] = []

    await telling(deps, (one) => trouble.push(one))(accountId, TOLD)

    expect(trouble).toEqual([])
  })
})
