import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DbHandle } from '../db/index.ts'
import type { EmailChannel, Told } from './notify.ts'
import type { PushDeps } from './push.ts'

import { createDb, runMigrations } from '../db/index.ts'
import { account, attendance, event, notificationSetting } from '../db/schema.ts'
import { notifyAttendees, recordAndPush } from './notify.ts'

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
  it('posts to them all at once rather than one mail server wait per person', async () => {
    // This deadlocks if the fan-out is sequential: nothing resolves until every
    // posting has started, and one after another the second never does. Which is the
    // defect in its own shape — fifteen seconds each against a host that drops
    // packets was ten minutes at the cap (#313).
    const deps = build()
    await givenBurn()
    for (let made = 0; made < 3; made += 1) await givenAttendee()

    let started = 0
    let release: () => void = () => undefined
    const allStarted = new Promise<void>((resolve) => (release = resolve))
    const byEmail: EmailChannel = async () => {
      started += 1
      if (started === 3) release()

      return await allStarted
    }

    const told = await notifyAttendees(
      deps.db,
      recordAndPush(deps, NOW_AT, () => undefined, byEmail),
      BURN,
      TOLD,
      { at: new Date(NOW) },
    )

    expect(told).toBe(3)
    expect(started).toBe(3)
  })

  it('still waits for all of them, so a route answering means the work is done', async () => {
    // The other half: side by side is not the same as unawaited. A test asserting on
    // what was sent must not have to race the response.
    const deps = build()
    await givenBurn()
    for (let made = 0; made < 3; made += 1) await givenAttendee()

    const posted: string[] = []
    const byEmail: EmailChannel = async (accountId) => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      posted.push(accountId)
    }

    await notifyAttendees(
      deps.db,
      recordAndPush(deps, NOW_AT, () => undefined, byEmail),
      BURN,
      TOLD,
      {
        at: new Date(NOW),
      },
    )

    expect(posted).toHaveLength(3)
  })
})

describe('a notification whose row cannot be written', () => {
  it('does not leave the email in flight with nobody holding it', async () => {
    // Node's default for an unhandled rejection is to exit the process. The email is
    // started before the insert and awaited after it, so anything thrown in between
    // used to leave it floating — and it rejects on a database error, which is the
    // same failure that makes the insert throw (#313).
    const unhandled: unknown[] = []
    const watch = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', watch)

    try {
      const deps = build()
      const accountId = await givenAsking()
      const byEmail: EmailChannel = () => Promise.reject(new Error('the database went away'))
      // Spied rather than stubbed, so the read that decides the channels still works:
      // the posting is only started after it, which is the window this is about.
      vi.spyOn(deps.db, 'insert').mockImplementation(() => {
        throw new Error('the database went away')
      })

      await expect(recordAndPush(deps, NOW_AT, () => undefined, byEmail)(accountId, TOLD)).rejects.toThrow(
        'the database went away',
      )

      // `unhandledRejection` fires once the microtask queue has drained, so a tick of
      // real time is what makes its absence mean anything.
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', watch)
    }
  })

  it('reports a send that failed rather than throwing over it', async () => {
    // The passing sibling: swallowing the rejection above must not swallow an
    // ordinary posting. `post` answers a failed send instead of throwing, so a
    // notification with a mail server that refused still writes its row and returns.
    const deps = build()
    const accountId = await givenAsking()
    const byEmail = vi.fn<EmailChannel>(() => Promise.resolve({ sent: false, reason: 'refused' }))

    await recordAndPush(deps, NOW_AT, () => undefined, byEmail)(accountId, TOLD)

    expect(byEmail).toHaveBeenCalledWith(accountId, TOLD)
  })
})
