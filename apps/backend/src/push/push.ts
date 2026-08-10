import { and, eq, inArray, isNull } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { Database } from '../db/index.ts'

import { installation, INSTALLATION_ID, pushSubscription } from '../db/schema.ts'

export interface Subscription {
  endpoint: string
  p256dh: string
  auth: string
}

export interface VapidKeys {
  publicKey: string
  privateKey: string
}

export type Delivery = (
  subscription: Subscription,
  payload: string,
  keys: VapidKeys,
) => Promise<'sent' | 'gone' | 'failed'>

export interface DeliveryCounts {
  sent: number
  failed: number
  gone: number
}

export interface PushDeps {
  db: Database
  deliver: Delivery
  now?: () => Date
  mintKeys: () => VapidKeys
}

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

export const rememberSubscription = async (
  deps: PushDeps,
  accountId: string,
  subscription: Subscription,
): Promise<void> => {
  const { db, now = () => new Date() } = deps

  await db
    .insert(pushSubscription)
    .values({ id: randomUUID(), account_id: accountId, ...subscription, created_at: now().toISOString() })
    .onConflictDoUpdate({
      target: pushSubscription.endpoint,
      set: { account_id: accountId, p256dh: subscription.p256dh, auth: subscription.auth },
    })
}

export const forgetSubscription = async (deps: PushDeps, endpoint: string): Promise<void> => {
  await deps.db.delete(pushSubscription).where(eq(pushSubscription.endpoint, endpoint))
}

const notifyRows = async (
  deps: PushDeps,
  rows: readonly { endpoint: string; p256dh: string; auth: string }[],
  payload: string,
): Promise<DeliveryCounts> => {
  const { db, deliver } = deps

  const none = { sent: 0, failed: 0, gone: 0 }

  if (rows.length === 0) return none

  const keys = await vapidKeysFor(deps)
  if (keys === undefined) return none

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

  const sent = results.filter((result) => result.status === 'fulfilled' && result.value === 'sent').length

  return { sent, gone: gone.length, failed: results.length - sent - gone.length }
}

const subscriptionColumns = {
  endpoint: pushSubscription.endpoint,
  p256dh: pushSubscription.p256dh,
  auth: pushSubscription.auth,
}

export const notifyAccount = async (
  deps: PushDeps,
  accountId: string,
  payload: string,
): Promise<DeliveryCounts> =>
  notifyRows(
    deps,
    await deps.db
      .select(subscriptionColumns)
      .from(pushSubscription)
      .where(eq(pushSubscription.account_id, accountId)),
    payload,
  )
