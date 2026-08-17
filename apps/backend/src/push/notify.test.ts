import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DbHandle } from '../db/index.ts'
import type { EmailChannel, Told } from './notify.ts'
import type { PushDeps } from './push.ts'

import { createDb, runMigrations } from '../db/index.ts'
import { account, attendance, event, notification, notificationSetting } from '../db/schema.ts'
import { createEmailQueue } from '../mail/queue.ts'
import { recordAndPush, tellAttendees } from './notify.ts'

const NOW = '2026-08-03T00:00:00.000Z'
const BURN = '9f1c2f2a-6f1a-4a2e-9c6d-2f0a1b3c4d5e'

let handle: DbHandle | undefined

afterEach(() => {
  handle?.close()
  handle = undefined
})

const db = () => {
  const found = handle?.db
  if (found === undefined) throw new Error('build() first')

  return found
}

const NOW_AT = () => new Date(NOW)

const build = (): PushDeps => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)

  return {
    db: handle.db,
    deliver: () => Promise.resolve('sent'),
    now: NOW_AT,
    mintKeys: () => ({ publicKey: 'pub', privateKey: 'priv' }),
  }
}

const givenAsking = async (): Promise<string> => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, created_at: NOW })
  await db()
    .insert(notificationSetting)
    .values({ account_id: id, category: 'dream_offered', enabled: true, email: true })

  return id
}

const givenAttendee = async (): Promise<string> => {
  const id = await givenAsking()
  await db().insert(attendance).values({ id: randomUUID(), event_id: BURN, account_id: id, joined_at: NOW })

  return id
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

describe('telling everybody coming to a burn', () => {
  it('does not make the request wait on one mail server wait per person', async () => {
    const deps = build()
    await givenBurn()
    for (let made = 0; made < 3; made += 1) await givenAttendee()

    const queue = createEmailQueue(() => undefined)
    const posted: string[] = []
    const byEmail: EmailChannel = async (accountId) => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      posted.push(accountId)
    }

    const told = await tellAttendees(
      deps.db,
      recordAndPush(deps, NOW_AT, () => undefined, { post: byEmail, defer: queue.defer }),
      BURN,
      TOLD,
    )

    expect(told).toBe(3)
    expect(posted).toEqual([])

    await queue.drain()

    expect(posted).toHaveLength(3)
  })

  it('posts them one at a time, so a burn does not dial the relay once per attendee at once', async () => {
    const deps = build()
    await givenBurn()
    for (let made = 0; made < 3; made += 1) await givenAttendee()

    const queue = createEmailQueue(() => undefined)
    let open = 0
    let most = 0
    const byEmail: EmailChannel = async () => {
      open += 1
      most = Math.max(most, open)
      await new Promise((resolve) => setTimeout(resolve, 1))
      open -= 1
    }

    await tellAttendees(
      deps.db,
      recordAndPush(deps, NOW_AT, () => undefined, { post: byEmail, defer: queue.defer }),
      BURN,
      TOLD,
    )
    await queue.drain()

    expect(most).toBe(1)
  })
})

describe('the email leg beside a bell row', () => {
  it('does not leave the email in flight when the row cannot be written', async () => {
    const unhandled: unknown[] = []
    const watch = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', watch)

    try {
      const deps = build()
      const accountId = await givenAsking()
      const failures: unknown[] = []
      const queue = createEmailQueue((failure) => failures.push(failure))
      const byEmail: EmailChannel = () => Promise.reject(new Error('the database went away'))
      vi.spyOn(deps.db, 'insert').mockImplementation(() => {
        throw new Error('the database went away')
      })

      await expect(
        recordAndPush(deps, NOW_AT, () => undefined, { post: byEmail, defer: queue.defer })(accountId, TOLD),
      ).rejects.toThrow('the database went away')

      await queue.drain()
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(unhandled).toEqual([])
      expect(failures).toHaveLength(1)
    } finally {
      process.off('unhandledRejection', watch)
    }
  })

  it('writes the row and posts, when nothing is broken', async () => {
    const deps = build()
    const accountId = await givenAsking()
    const queue = createEmailQueue(() => undefined)
    const byEmail = vi.fn<EmailChannel>(() => Promise.resolve({ sent: false, reason: 'refused' }))

    await recordAndPush(deps, NOW_AT, () => undefined, { post: byEmail, defer: queue.defer })(accountId, TOLD)
    await queue.drain()

    expect(byEmail).toHaveBeenCalledWith(accountId, { ...TOLD, batch: expect.any(String) })
    const rows = await db().select().from(notification).where(eq(notification.account_id, accountId))
    expect(rows.map((row) => row.body)).toEqual([TOLD.body])
  })
})
