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

/**
 * The two halves of a notification that are about *timing* rather than about wording:
 * that a fan-out does not wait on one mail server per person, and that the email leg
 * can never be left in flight with nobody holding it.
 *
 * Everything else about who is told what is covered from the routes, in
 * `general-notifications.test.ts`, which is where the audience rules live.
 */

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
    // Nobody is subscribed in these tests, so this is never reached — the bell row is
    // what the fan-out writes and what the timing is about.
    deliver: () => Promise.resolve('sent'),
    now: NOW_AT,
    mintKeys: () => ({ publicKey: 'pub', privateKey: 'priv' }),
  }
}

/** Somebody who has asked for this category on both channels — email is off until asked (#30). */
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
    // What #313 was about, kept: forty-two fifteen-second waits inside one request is
    // about ten minutes at the cap. What #356 changed is that it is now *no* waits —
    // the fan-out queues its posts and answers.
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
    // `sendWithSmtp` opens a connection per message. Small relays cap concurrent
    // connections and refuse the overflow, which `post` turns into a quiet `sent:
    // false` — so the failure mode was missing email rather than slow email (#356).
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
    // Node's default for an unhandled rejection is to exit the process, and a database
    // that has gone away fails the insert *and* the posting (#313). The queue is what
    // holds the rejection now — it is queued before the insert, so a throw in between
    // cannot leave it floating, and the queue reports rather than rethrows.
    const unhandled: unknown[] = []
    const watch = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', watch)

    try {
      const deps = build()
      const accountId = await givenAsking()
      const failures: unknown[] = []
      const queue = createEmailQueue((failure) => failures.push(failure))
      const byEmail: EmailChannel = () => Promise.reject(new Error('the database went away'))
      // Spied rather than stubbed, so the read that decides the channels still works:
      // the posting is only queued after it, which is the window this is about.
      vi.spyOn(deps.db, 'insert').mockImplementation(() => {
        throw new Error('the database went away')
      })

      await expect(
        recordAndPush(deps, NOW_AT, () => undefined, { post: byEmail, defer: queue.defer })(accountId, TOLD),
      ).rejects.toThrow('the database went away')

      await queue.drain()
      // `unhandledRejection` fires once the microtask queue has drained, so a tick of
      // real time is what makes its absence mean anything.
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(unhandled).toEqual([])
      expect(failures).toHaveLength(1)
    } finally {
      process.off('unhandledRejection', watch)
    }
  })

  it('writes the row and posts, when nothing is broken', async () => {
    // The passing sibling: the guard above must not swallow an ordinary posting.
    // `emailChannel` answers a failed send instead of throwing, so a mail server that
    // refused still leaves the bell row behind.
    const deps = build()
    const accountId = await givenAsking()
    const queue = createEmailQueue(() => undefined)
    const byEmail = vi.fn<EmailChannel>(() => Promise.resolve({ sent: false, reason: 'refused' }))

    await recordAndPush(deps, NOW_AT, () => undefined, { post: byEmail, defer: queue.defer })(accountId, TOLD)
    await queue.drain()

    // The batch id `recordAndPush` pins, so the email leg's count lands on the same row.
    expect(byEmail).toHaveBeenCalledWith(accountId, { ...TOLD, batch: expect.any(String) })
    const rows = await db().select().from(notification).where(eq(notification.account_id, accountId))
    expect(rows.map((row) => row.body)).toEqual([TOLD.body])
  })
})
