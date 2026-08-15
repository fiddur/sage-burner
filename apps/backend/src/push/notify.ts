import type { DigestChoice, Notification, NotificationCategory } from '@sage-burner/shared'

import {
  DEFAULT_DIGEST,
  mentionedAccounts,
  mentionsEverybody,
  notificationCategories,
  notifiesByDefault,
} from '@sage-burner/shared'
import { and, count, desc, eq, inArray, isNull, lt, lte, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { Database } from '../db/index.ts'
import type { Posted } from '../mail/mail.ts'
import type { EmailQueue } from '../mail/queue.ts'
import type { DeliveryCounts, PushDeps } from './push.ts'

import {
  account,
  accountRole,
  attendance,
  notification,
  notificationBatch,
  notificationSetting,
} from '../db/schema.ts'
import { notifyAccount } from './push.ts'

export interface Told {
  category: NotificationCategory
  body: string
  link: string | null
  batch?: string
}

export const RETENTION_DAYS = 90

interface Counted {
  told?: number
  suppressed?: number
  emailed?: number
  accepted?: number
  failed?: number
  gone?: number
}

/**
 * One notification, however many people it reaches. Every loop that tells a shared audience the
 * same thing calls this once and passes the result to each `notify`, so `notification_batch` gets
 * one row rather than one per recipient — which is what makes the log readable at all.
 */
export const oneBatch = (told: Told): Told => ({ ...told, batch: told.batch ?? randomUUID() })

const countInto = async (db: Database, at: Date, told: Told, counted: Counted) => {
  const id = told.batch ?? randomUUID()

  const opened = await db
    .insert(notificationBatch)
    .values({
      id,
      category: told.category,
      body: told.body,
      link: told.link,
      created_at: at.toISOString(),
    })
    .onConflictDoNothing()
    .returning({ id: notificationBatch.id })

  if (opened.length > 0) {
    await db
      .delete(notificationBatch)
      .where(
        lt(
          notificationBatch.created_at,
          new Date(at.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
        ),
      )
  }

  await db
    .update(notificationBatch)
    .set({
      told: sql`${notificationBatch.told} + ${counted.told ?? 0}`,
      suppressed: sql`${notificationBatch.suppressed} + ${counted.suppressed ?? 0}`,
      emailed: sql`${notificationBatch.emailed} + ${counted.emailed ?? 0}`,
      accepted: sql`${notificationBatch.accepted} + ${counted.accepted ?? 0}`,
      failed: sql`${notificationBatch.failed} + ${counted.failed ?? 0}`,
      gone: sql`${notificationBatch.gone} + ${counted.gone ?? 0}`,
    })
    .where(eq(notificationBatch.id, id))
}

export const notificationBatches = async (db: Database, limit: number) =>
  await db
    .select()
    .from(notificationBatch)
    .orderBy(desc(notificationBatch.created_at), desc(notificationBatch.id))
    .limit(limit)

export type Notifier = (accountId: string, told: Told) => Promise<unknown>

/**
 * Answers what the mail server did with it — `undefined` where the installation has no mail
 * server or the account no address, so nothing was attempted at all.
 */
export type EmailChannel = (accountId: string, told: Told) => Promise<Posted | undefined>

export interface Email {
  post: EmailChannel
  defer: EmailQueue['defer']
}

const pushPayload = ({ body, link, category }: Told): string => JSON.stringify({ body, link, category })

export interface Channels {
  bell: boolean
  email: boolean
}

export const wants = async (
  db: Database,
  accountId: string,
  category: NotificationCategory,
): Promise<Channels> => {
  const [row] = await db
    .select({ enabled: notificationSetting.enabled, email: notificationSetting.email })
    .from(notificationSetting)
    .where(and(eq(notificationSetting.account_id, accountId), eq(notificationSetting.category, category)))
    .limit(1)

  return { bell: row?.enabled ?? notifiesByDefault(category), email: row?.email ?? false }
}

export const reachedByMention = async (db: Database, named: readonly string[]): Promise<string[]> => {
  const asked = await Promise.all(
    named.map(async (accountId) => {
      const channels = await wants(db, accountId, 'mentioned')

      return channels.bell || channels.email ? [accountId] : []
    }),
  )

  return asked.flat()
}

export type PushTrouble = DeliveryCounts & { account_id: string; category: NotificationCategory }

export const recordAndPush =
  (deps: PushDeps, now: () => Date, log: (trouble: PushTrouble) => void, email?: Email): Notifier =>
  async (accountId, told) => {
    const channels = await wants(deps.db, accountId, told.category)
    const one = oneBatch(told)

    if (channels.email && email !== undefined) {
      email.defer(async () => {
        const posted = await email.post(accountId, one)
        if (posted?.sent === true) await countInto(deps.db, now(), one, { emailed: 1 })
      })
    }

    if (!channels.bell) {
      await countInto(deps.db, now(), one, { suppressed: 1 })

      return undefined
    }

    await deps.db.insert(notification).values({
      id: randomUUID(),
      account_id: accountId,
      category: one.category,
      body: one.body,
      link: one.link,
      created_at: now().toISOString(),
    })

    const counts = await notifyAccount(deps, accountId, pushPayload(one))
    if (counts.failed > 0 || counts.gone > 0) {
      log({ ...counts, account_id: accountId, category: one.category })
    }

    await countInto(deps.db, now(), one, {
      told: 1,
      accepted: counts.sent,
      failed: counts.failed,
      gone: counts.gone,
    })

    return counts
  }

export const switchedOn = async (
  db: Database,
  accountId: string,
): Promise<{ on: NotificationCategory[]; email: NotificationCategory[]; digest: DigestChoice }> => {
  const rows = await db
    .select({
      category: notificationSetting.category,
      enabled: notificationSetting.enabled,
      email: notificationSetting.email,
    })
    .from(notificationSetting)
    .where(eq(notificationSetting.account_id, accountId))

  const said = new Map(rows.map((row) => [row.category, row]))

  const [who] = await db
    .select({ digest: account.digest })
    .from(account)
    .where(eq(account.id, accountId))
    .limit(1)

  return {
    on: notificationCategories.filter(
      (category) => said.get(category)?.enabled ?? notifiesByDefault(category),
    ),
    email: notificationCategories.filter((category) => said.get(category)?.email ?? false),
    digest: who?.digest ?? DEFAULT_DIGEST,
  }
}

export const displayName = async (db: Database, accountId: string): Promise<string> => {
  const [row] = await db
    .select({ name: account.name })
    .from(account)
    .where(eq(account.id, accountId))
    .limit(1)

  return row?.name ?? 'Somebody'
}

export const tellAttendees = async (
  db: Database,
  notify: Notifier,
  eventId: string,
  told: Told,
  { except = [] }: { except?: readonly (string | undefined)[] } = {},
): Promise<number> => {
  const rows = await db
    .select({ account_id: attendance.account_id })
    .from(attendance)
    .where(eq(attendance.event_id, eventId))

  const silent = new Set(except)
  const audience = rows.filter((row) => !silent.has(row.account_id))
  const one = oneBatch(told)

  await Promise.all(audience.map(async (row) => await notify(row.account_id, one)))

  return audience.length
}

export const approvedAccounts = async (db: Database): Promise<string[]> => {
  const rows = await db
    .selectDistinct({ account_id: accountRole.account_id })
    .from(accountRole)
    .where(inArray(accountRole.role, ['admin', 'member']))

  return rows.map((row) => row.account_id)
}

export const tellApproved = async (
  db: Database,
  notify: Notifier,
  told: Told,
  { except = [] }: { except?: readonly (string | undefined)[] } = {},
): Promise<number> => {
  const silent = new Set(except)
  const audience = (await approvedAccounts(db)).filter((accountId) => !silent.has(accountId))
  const one = oneBatch(told)

  await Promise.all(audience.map(async (accountId) => await notify(accountId, one)))

  return audience.length
}

/**
 * The burn's attendance is the audience for a mention, and every approved account is where
 * there is no burn — the songbook is global, so `@everybody` there cannot mean one gathering.
 */
export const namedBy = async (
  db: Database,
  body: string,
  eventId: string | null,
  author: string,
): Promise<string[]> => {
  const reachable =
    eventId === null
      ? await approvedAccounts(db)
      : (
          await db
            .select({ account_id: attendance.account_id })
            .from(attendance)
            .where(eq(attendance.event_id, eventId))
        ).map((row) => row.account_id)

  const audience = new Set(reachable)
  audience.delete(author)

  if (mentionsEverybody(body)) return [...audience]

  return mentionedAccounts(body).filter((id) => audience.has(id))
}

export const notifyAdmins = async (db: Database, notify: Notifier, told: Told): Promise<number> => {
  const rows = await db
    .select({ account_id: accountRole.account_id })
    .from(accountRole)
    .where(eq(accountRole.role, 'admin'))

  const one = oneBatch(told)
  for (const row of rows) await notify(row.account_id, one)

  return rows.length
}

export const notifyEveryone = async (db: Database, notify: Notifier, told: Told): Promise<number> => {
  const rows = await db.select({ id: account.id }).from(account)

  const one = oneBatch(told)
  for (const row of rows) await notify(row.id, one)

  return rows.length
}

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

  const [tally] = await db
    .select({ unseen: count() })
    .from(notification)
    .where(and(eq(notification.account_id, accountId), isNull(notification.seen_at)))

  return {
    notifications: rows satisfies Notification[],
    unseen: tally?.unseen ?? 0,
  }
}

export const markShownSeen = async (
  db: Database,
  accountId: string,
  { link, asOf }: { link: string; asOf: string },
  at: Date,
) => {
  await db
    .update(notification)
    .set({ seen_at: at.toISOString() })
    .where(
      and(
        eq(notification.account_id, accountId),
        eq(notification.link, link),
        lte(notification.created_at, asOf),
        isNull(notification.seen_at),
      ),
    )
}

export const markSeen = async (db: Database, accountId: string, at: Date) => {
  await db
    .update(notification)
    .set({ seen_at: at.toISOString() })
    .where(and(eq(notification.account_id, accountId), isNull(notification.seen_at)))
}
