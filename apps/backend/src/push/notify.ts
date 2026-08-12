import type { Notification, NotificationCategory } from '@sage-burner/shared'

import {
  mentionedAccounts,
  mentionsEverybody,
  notificationCategories,
  notifiesByDefault,
} from '@sage-burner/shared'
import { and, count, desc, eq, inArray, isNull, lte } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { Database } from '../db/index.ts'
import type { EmailQueue } from '../mail/queue.ts'
import type { DeliveryCounts, PushDeps } from './push.ts'

import {
  account,
  accountRole,
  activity,
  attendance,
  notification,
  notificationSetting,
} from '../db/schema.ts'
import { notifyAccount } from './push.ts'

export interface Told {
  category: NotificationCategory
  body: string
  link: string | null
}

export type Notifier = (accountId: string, told: Told) => Promise<unknown>

export type EmailChannel = (accountId: string, told: Told) => Promise<unknown>

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

export const recordAndPush =
  (deps: PushDeps, now: () => Date, log: (counts: DeliveryCounts) => void, email?: Email): Notifier =>
  async (accountId, told) => {
    const channels = await wants(deps.db, accountId, told.category)

    if (channels.email && email !== undefined) {
      email.defer(async () => await email.post(accountId, told))
    }

    if (!channels.bell) return undefined

    await deps.db.insert(notification).values({
      id: randomUUID(),
      account_id: accountId,
      category: told.category,
      body: told.body,
      link: told.link,
      created_at: now().toISOString(),
    })

    const counts = await notifyAccount(deps, accountId, pushPayload(told))
    if (counts.failed > 0 || counts.gone > 0) log(counts)

    return counts
  }

export const switchedOn = async (
  db: Database,
  accountId: string,
): Promise<{ on: NotificationCategory[]; email: NotificationCategory[] }> => {
  const rows = await db
    .select({
      category: notificationSetting.category,
      enabled: notificationSetting.enabled,
      email: notificationSetting.email,
    })
    .from(notificationSetting)
    .where(eq(notificationSetting.account_id, accountId))

  const said = new Map(rows.map((row) => [row.category, row]))

  return {
    on: notificationCategories.filter(
      (category) => said.get(category)?.enabled ?? notifiesByDefault(category),
    ),
    email: notificationCategories.filter((category) => said.get(category)?.email ?? false),
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

export const recordActivity = async (db: Database, eventId: string, told: Told, at: Date) => {
  await db.insert(activity).values({
    id: randomUUID(),
    event_id: eventId,
    category: told.category,
    body: told.body,
    link: told.link,
    created_at: at.toISOString(),
  })
}

export const notifyAttendees = async (
  db: Database,
  notify: Notifier,
  eventId: string,
  told: Told,
  { except = [], at }: { at: Date; except?: readonly (string | undefined)[] },
): Promise<number> => {
  await recordActivity(db, eventId, told, at)

  return await tellAttendees(db, notify, eventId, told, { except })
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

  await Promise.all(audience.map(async (row) => await notify(row.account_id, told)))

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

  await Promise.all(audience.map(async (accountId) => await notify(accountId, told)))

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

  for (const row of rows) await notify(row.account_id, told)

  return rows.length
}

export const notifyEveryone = async (db: Database, notify: Notifier, told: Told): Promise<number> => {
  const rows = await db.select({ id: account.id }).from(account)

  for (const row of rows) await notify(row.id, told)

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
