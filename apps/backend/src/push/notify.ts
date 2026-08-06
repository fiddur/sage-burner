import type { Notification, NotificationCategory } from '@sage-burner/shared'

import { and, desc, eq, isNull } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { Database } from '../db/index.ts'
import type { DeliveryCounts, PushDeps } from './push.ts'

import { notification, notificationMute } from '../db/schema.ts'
import { notifyAccount } from './push.ts'

/** What a route says happened. The wording and the page it belongs to. */
export interface Told {
  category: NotificationCategory
  body: string
  /** A path in this app. Null for anything with no page of its own. */
  link: string | null
}

export type Notifier = (accountId: string, told: Told) => Promise<unknown>

const muted = async (db: Database, accountId: string, category: NotificationCategory) => {
  const [row] = await db
    .select({ category: notificationMute.category })
    .from(notificationMute)
    .where(and(eq(notificationMute.account_id, accountId), eq(notificationMute.category, category)))
    .limit(1)

  return row !== undefined
}

/**
 * Tell somebody something happened to them (#248).
 *
 * The row is written first and the push is a copy of it, which is the order that
 * matters: a push service being unreachable must not cost somebody the record, and
 * the bell is the surface that is always there. A member with no subscription gets
 * the bell and nothing else, which is the ordinary case.
 *
 * A muted category is not written at all. The setting says "notify me", so switching
 * it off means neither channel — a bell that fills up with things somebody asked not
 * to hear about is the same noise in a quieter place.
 */
export const recordAndPush =
  (deps: PushDeps, now: () => Date, log: (counts: DeliveryCounts) => void): Notifier =>
  async (accountId, told) => {
    if (await muted(deps.db, accountId, told.category)) return

    await deps.db.insert(notification).values({
      id: randomUUID(),
      account_id: accountId,
      category: told.category,
      body: told.body,
      link: told.link,
      created_at: now().toISOString(),
    })

    const counts = await notifyAccount(deps, accountId, JSON.stringify({ body: told.body }))
    if (counts.failed > 0 || counts.gone > 0) log(counts)

    return counts
  }

/** The bell's list, newest first, with what the red bubble counts. */
export const notificationsFor = async (db: Database, accountId: string) => {
  const rows = await db
    .select({
      id: notification.id,
      category: notification.category,
      body: notification.body,
      link: notification.link,
      created_at: notification.created_at,
      seen_at: notification.seen_at,
    })
    .from(notification)
    .where(eq(notification.account_id, accountId))
    .orderBy(desc(notification.created_at))
    .limit(50)

  return {
    notifications: rows satisfies Notification[],
    unseen: rows.filter((row) => row.seen_at === null).length,
  }
}

/**
 * Everything unseen becomes seen.
 *
 * Scoped to what is already unseen rather than stamping the lot, so a row that
 * arrived while the panel was open keeps the date it was actually read at — and so
 * opening the bell twice does not rewrite yesterday's.
 */
export const markSeen = async (db: Database, accountId: string, at: Date) => {
  await db
    .update(notification)
    .set({ seen_at: at.toISOString() })
    .where(and(eq(notification.account_id, accountId), isNull(notification.seen_at)))
}
