import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DbHandle } from '../db/index.ts'
import type { Delivery, PushDeps, Subscription } from './push.ts'

import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, installation, INSTALLATION_ID, pushSubscription } from '../db/schema.ts'
import { forgetSubscription, notifyAdmins, rememberSubscription, vapidKeysFor } from './push.ts'

/**
 * Browser push, with the push service replaced by a spy.
 *
 * Delivery itself cannot be exercised here — it needs a real browser to produce a
 * subscription and a real push service to accept one — so `deliver` is injected and
 * what these tests pin is everything around it: who gets sent to, that the payload
 * is the same for all of them, and that a subscription the service reports gone is
 * deleted rather than retried forever.
 */

const NOW = '2026-08-03T00:00:00.000Z'

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

const KEYS = { publicKey: 'pub-key', privateKey: 'priv-key' }

const build = async (deliver: Delivery = () => Promise.resolve('sent')): Promise<PushDeps> => {
  handle = createDb({ url: ':memory:' })
  // The migrations seed the one `installation` row, so there is nothing to insert.
  runMigrations(handle)

  return { db: handle.db, deliver, now: () => new Date(NOW), mintKeys: () => KEYS }
}

const givenAccount = async (roles: ('admin' | 'member')[]) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  return id
}

const aSubscription = (endpoint: string): Subscription => ({ endpoint, p256dh: 'p', auth: 'a' })

const stored = async () => db().select().from(pushSubscription)

describe('the VAPID pair', () => {
  it('is minted on first use and kept', async () => {
    // Kept rather than derived: the public half is baked into every subscription a
    // browser has already made, so a fresh pair would orphan all of them.
    const deps = await build()

    const first = await vapidKeysFor(deps)
    const second = await vapidKeysFor({ ...deps, mintKeys: () => ({ publicKey: 'x', privateKey: 'y' }) })

    expect(first).toEqual(KEYS)
    expect(second).toEqual(KEYS)
  })

  it('is written to the installation, not held in memory', async () => {
    const deps = await build()

    await vapidKeysFor(deps)

    const [row] = await db().select().from(installation).where(eq(installation.id, INSTALLATION_ID))
    expect(row?.vapid_public_key).toBe('pub-key')
    expect(row?.vapid_private_key).toBe('priv-key')
  })
})

describe('remembering a browser', () => {
  it('stores one row per browser', async () => {
    const deps = await build()
    const admin = await givenAccount(['admin'])

    await rememberSubscription(deps, admin, aSubscription('https://push.example/one'))
    await rememberSubscription(deps, admin, aSubscription('https://push.example/two'))

    expect(await stored()).toHaveLength(2)
  })

  it('refreshes rather than duplicates when the same browser subscribes again', async () => {
    // A reload re-subscribes, and a browser may rotate its keys without changing
    // the endpoint. Two rows for one browser would mean two notifications.
    const deps = await build()
    const admin = await givenAccount(['admin'])

    await rememberSubscription(deps, admin, aSubscription('https://push.example/one'))
    await rememberSubscription(deps, admin, {
      endpoint: 'https://push.example/one',
      p256dh: 'rotated',
      auth: 'rotated',
    })

    const rows = await stored()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.p256dh).toBe('rotated')
  })

  it('moves a browser to whoever last signed in on it', async () => {
    // A shared laptop. The endpoint belongs to the browser, not the person, so the
    // row follows the account that subscribed last rather than notifying the one
    // who used it first.
    const deps = await build()
    const first = await givenAccount(['admin'])
    const second = await givenAccount(['admin'])

    await rememberSubscription(deps, first, aSubscription('https://push.example/shared'))
    await rememberSubscription(deps, second, aSubscription('https://push.example/shared'))

    const rows = await stored()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.account_id).toBe(second)
  })

  it('forgets one, and says nothing about one it never had', async () => {
    const deps = await build()
    const admin = await givenAccount(['admin'])
    await rememberSubscription(deps, admin, aSubscription('https://push.example/one'))

    await forgetSubscription(deps, 'https://push.example/one')
    await forgetSubscription(deps, 'https://push.example/never')

    expect(await stored()).toEqual([])
  })

  it('goes with the account, so a deleted one leaves no live subscription', async () => {
    const deps = await build()
    const admin = await givenAccount(['admin'])
    await rememberSubscription(deps, admin, aSubscription('https://push.example/one'))

    await db().delete(account).where(eq(account.id, admin))

    expect(await stored()).toEqual([])
  })
})

describe('notifying the admins', () => {
  it('sends to every admin browser, and to no one else', async () => {
    const deliver = vi.fn<Delivery>(() => Promise.resolve('sent'))
    const deps = await build(deliver)
    const admin = await givenAccount(['admin'])
    const member = await givenAccount(['member'])
    const roleless = await givenAccount([])

    await rememberSubscription(deps, admin, aSubscription('https://push.example/laptop'))
    await rememberSubscription(deps, admin, aSubscription('https://push.example/phone'))
    await rememberSubscription(deps, member, aSubscription('https://push.example/member'))
    await rememberSubscription(deps, roleless, aSubscription('https://push.example/roleless'))

    const counts = await notifyAdmins(deps, 'someone applied')

    expect(counts.sent).toBe(2)
    expect(deliver.mock.calls.map((call) => call[0].endpoint).sort()).toEqual([
      'https://push.example/laptop',
      'https://push.example/phone',
    ])
    expect(deliver.mock.calls.every((call) => call[1] === 'someone applied')).toBe(true)
  })

  it('counts an admin once who also holds member', async () => {
    // The join goes through `account_role`, so without care two rows for one
    // account would send twice to the same browser.
    const deliver = vi.fn<Delivery>(() => Promise.resolve('sent'))
    const deps = await build(deliver)
    const both = await givenAccount(['admin', 'member'])
    await rememberSubscription(deps, both, aSubscription('https://push.example/one'))

    expect((await notifyAdmins(deps, 'x')).sent).toBe(1)
    expect(deliver).toHaveBeenCalledTimes(1)
  })

  it('cleans up the gone ones even when another delivery rejects outright', async () => {
    // `Delivery` may reject — the type permits it — and with `Promise.all` one
    // rejection skipped the cleanup for every other row in the batch.
    const deps = await build((subscription) => {
      if (subscription.endpoint.endsWith('/throws')) return Promise.reject(new Error('boom'))
      return Promise.resolve(subscription.endpoint.endsWith('/dead') ? 'gone' : 'sent')
    })
    const admin = await givenAccount(['admin'])
    await rememberSubscription(deps, admin, aSubscription('https://push.example/throws'))
    await rememberSubscription(deps, admin, aSubscription('https://push.example/dead'))
    await rememberSubscription(deps, admin, aSubscription('https://push.example/alive'))

    const counts = await notifyAdmins(deps, 'x')

    expect(counts).toEqual({ sent: 1, gone: 1, failed: 1 })
    expect((await stored()).map((row) => row.endpoint).sort()).toEqual([
      'https://push.example/alive',
      'https://push.example/throws',
    ])
  })

  it('deletes a subscription the push service says is gone', async () => {
    // 404 or 410 means the browser threw it away. Keeping it would retry a dead
    // endpoint on every application, forever.
    const deps = await build((subscription) =>
      Promise.resolve(subscription.endpoint.endsWith('/dead') ? 'gone' : 'sent'),
    )
    const admin = await givenAccount(['admin'])
    await rememberSubscription(deps, admin, aSubscription('https://push.example/dead'))
    await rememberSubscription(deps, admin, aSubscription('https://push.example/alive'))

    expect((await notifyAdmins(deps, 'x')).sent).toBe(1)

    expect((await stored()).map((row) => row.endpoint)).toEqual(['https://push.example/alive'])
  })

  it('keeps a subscription that merely failed', async () => {
    // The passing sibling of the case above, and the distinction that matters: a
    // 500 from a push service is not a reason to forget someone's phone.
    const deps = await build(() => Promise.resolve('failed'))
    const admin = await givenAccount(['admin'])
    await rememberSubscription(deps, admin, aSubscription('https://push.example/flaky'))

    expect((await notifyAdmins(deps, 'x')).sent).toBe(0)

    expect(await stored()).toHaveLength(1)
  })

  it('does nothing, and mints nothing, when no admin has opted in', async () => {
    const deliver = vi.fn<Delivery>(() => Promise.resolve('sent'))
    const deps = await build(deliver)
    await givenAccount(['admin'])

    expect((await notifyAdmins(deps, 'x')).sent).toBe(0)
    expect(deliver).not.toHaveBeenCalled()
    // And no key: an installation nobody has opted into should not acquire one
    // because a stranger applied.
    const [row] = await db().select().from(installation).where(eq(installation.id, INSTALLATION_ID))
    expect(row?.vapid_public_key).toBeNull()
  })
})
