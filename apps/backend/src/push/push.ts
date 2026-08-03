import { and, eq, inArray, isNull } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { Database } from '../db/index.ts'

import { account, accountRole, installation, INSTALLATION_ID, pushSubscription } from '../db/schema.ts'

/** What a browser hands over when it subscribes. */
export interface Subscription {
  endpoint: string
  p256dh: string
  auth: string
}

/** The VAPID pair, as `web-push` spells it. */
export interface VapidKeys {
  publicKey: string
  privateKey: string
}

/**
 * One delivery attempt, injected so nothing in the suite reaches a push service.
 *
 * `gone` is the case that matters: a push service answers 404 or 410 for a
 * subscription the browser has thrown away — permissions revoked, profile wiped,
 * the app uninstalled — and the row has to go with it, or every future send
 * retries a dead endpoint forever. Anything else is `failed`: a 500 from Google is
 * not a reason to forget someone's phone.
 */
export type Delivery = (
  subscription: Subscription,
  payload: string,
  keys: VapidKeys,
) => Promise<'sent' | 'gone' | 'failed'>

export interface PushDeps {
  db: Database
  deliver: Delivery
  now?: () => Date
  mintKeys: () => VapidKeys
}

/**
 * The installation's VAPID pair, minted on first use.
 *
 * Kept rather than derived: the public half is baked into every subscription a
 * browser has made, so a new pair silently orphans all of them. That is also why
 * this reads before it writes rather than upserting.
 */
export const vapidKeysFor = async ({ db, mintKeys }: PushDeps): Promise<VapidKeys | undefined> => {
  const [row] = await db
    .select({ publicKey: installation.vapid_public_key, privateKey: installation.vapid_private_key })
    .from(installation)
    .where(eq(installation.id, INSTALLATION_ID))
    .limit(1)

  if (row === undefined) return undefined
  if (row.publicKey !== null && row.privateKey !== null) {
    return { publicKey: row.publicKey, privateKey: row.privateKey }
  }

  // Conditional on the columns still being null, and the loser re-reads rather
  // than overwriting. Two admins turning notifications on at the same moment would
  // otherwise both mint and the second write would win — leaving the first one's
  // browser subscribed against a key the installation no longer holds, and every
  // send to it failing forever with nothing to say why.
  //
  // Untested, and honestly so: `node:sqlite` is synchronous, so two calls in one
  // process serialise and the second returns at the read above rather than
  // reaching this. A test written for it passed with the condition removed, which
  // is no test. Kept because the failure it prevents is silent and permanent, and
  // the cost is a `WHERE` clause.
  const minted = mintKeys()
  const [claimed] = await db
    .update(installation)
    .set({ vapid_public_key: minted.publicKey, vapid_private_key: minted.privateKey })
    .where(
      and(
        eq(installation.id, INSTALLATION_ID),
        isNull(installation.vapid_public_key),
        isNull(installation.vapid_private_key),
      ),
    )
    .returning({ publicKey: installation.vapid_public_key })

  if (claimed !== undefined) return minted

  const [existing] = await db
    .select({ publicKey: installation.vapid_public_key, privateKey: installation.vapid_private_key })
    .from(installation)
    .where(eq(installation.id, INSTALLATION_ID))
    .limit(1)

  return existing?.publicKey != null && existing.privateKey != null
    ? { publicKey: existing.publicKey, privateKey: existing.privateKey }
    : undefined
}

/** Store one browser's permission, or refresh what it already had. */
export const rememberSubscription = async (
  deps: PushDeps,
  accountId: string,
  subscription: Subscription,
): Promise<void> => {
  const { db, now = () => new Date() } = deps

  // Re-subscribing from the same browser is ordinary — a reload does it — so the
  // endpoint's UNIQUE decides, and the keys are refreshed rather than duplicated.
  // They do change: a browser may rotate them without changing the endpoint.
  await db
    .insert(pushSubscription)
    .values({ id: randomUUID(), account_id: accountId, ...subscription, created_at: now().toISOString() })
    .onConflictDoUpdate({
      target: pushSubscription.endpoint,
      set: { account_id: accountId, p256dh: subscription.p256dh, auth: subscription.auth },
    })
}

/** Forget one browser. Silent when it was already forgotten. */
export const forgetSubscription = async (deps: PushDeps, endpoint: string): Promise<void> => {
  await deps.db.delete(pushSubscription).where(eq(pushSubscription.endpoint, endpoint))
}

/**
 * Notify every admin who has opted in, on every browser they opted in from.
 *
 * Failures are swallowed by design. The one caller is the public application
 * route, and an applicant must not be told their application failed because
 * Google was slow — the application is already written by the time this runs.
 * Delivery is reported to the log and nowhere else.
 */
export const notifyAdmins = async (deps: PushDeps, payload: string): Promise<number> => {
  const { db, deliver } = deps

  const rows = await db
    .select({
      endpoint: pushSubscription.endpoint,
      p256dh: pushSubscription.p256dh,
      auth: pushSubscription.auth,
    })
    .from(pushSubscription)
    .innerJoin(account, eq(account.id, pushSubscription.account_id))
    .innerJoin(accountRole, eq(accountRole.account_id, account.id))
    .where(eq(accountRole.role, 'admin'))

  // Asked for after the subscriptions, not before: an installation nobody has
  // opted into should not acquire a key as a side effect of someone applying.
  if (rows.length === 0) return 0

  const keys = await vapidKeysFor(deps)
  if (keys === undefined) return 0

  // `allSettled`, so one `Delivery` that rejects cannot skip the cleanup for every
  // other row in the batch. `deliverWithWebPush` catches everything and never
  // rejects, but the type permits it and a future implementation might.
  const results = await Promise.allSettled(rows.map((row) => deliver(row, payload, keys)))
  const gone = rows
    .filter((_row, index) => {
      const result = results[index]
      return result?.status === 'fulfilled' && result.value === 'gone'
    })
    .map((row) => row.endpoint)

  if (gone.length > 0) {
    await db.delete(pushSubscription).where(inArray(pushSubscription.endpoint, gone))
  }

  return results.filter((result) => result.status === 'fulfilled' && result.value === 'sent').length
}
