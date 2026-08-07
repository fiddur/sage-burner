import type { Notification, NotificationCategory } from '@sage-burner/shared'

import { notificationCategories, notifiesByDefault } from '@sage-burner/shared'
import { and, count, desc, eq, isNull } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { Database } from '../db/index.ts'
import type { DeliveryCounts, PushDeps } from './push.ts'

import { account, attendance, notification, notificationSetting } from '../db/schema.ts'
import { notifyAccount } from './push.ts'

/** What a route says happened. The wording and the page it belongs to. */
export interface Told {
  category: NotificationCategory
  body: string
  /** A path in this app. Null for anything with no page of its own. */
  link: string | null
}

export type Notifier = (accountId: string, told: Told) => Promise<unknown>

/**
 * What a push carries, and the one place it is built (#279).
 *
 * There are two senders and they had drifted. `recordAndPush` below covers everything
 * that is also a bell row; the applications callback in `app.ts` is neither a row nor
 * a setting — it predates both — and went on sending a body alone. That was invisible
 * while the worker had a page written into it, and became the one notification going
 * nowhere the moment it stopped.
 *
 * `category` is optional for exactly that sender. It is what a notification collapses
 * with, and one that has no category collapses with the others that have none — which
 * today is only itself, and is the behaviour the applications push always had.
 */
export interface Pushed {
  body: string
  /** A path in this app. Null for anything with no page of its own. */
  link: string | null
  category?: NotificationCategory
}

export const pushPayload = ({ body, link, category }: Pushed): string =>
  JSON.stringify({ body, link, category })

/**
 * Whether this person wants to hear about this.
 *
 * A stored row is what they said; absence is that they have not said, and the
 * default answers instead. That indirection is the whole reason the table carries
 * `enabled` rather than only listing mutes — six categories are on unless refused
 * and five are off unless asked for, and "is there a row" cannot mean both (#259).
 */
export const wants = async (db: Database, accountId: string, category: NotificationCategory) => {
  const [row] = await db
    .select({ enabled: notificationSetting.enabled })
    .from(notificationSetting)
    .where(and(eq(notificationSetting.account_id, accountId), eq(notificationSetting.category, category)))
    .limit(1)

  return row?.enabled ?? notifiesByDefault(category)
}

/**
 * Tell somebody something happened to them (#248).
 *
 * The row is written first and the push is a copy of it, which is the order that
 * matters: a push service being unreachable must not cost somebody the record, and
 * the bell is the surface that is always there. A member with no subscription gets
 * the bell and nothing else, which is the ordinary case.
 *
 * A category somebody does not want is not written at all. The setting says "notify
 * me", so switching it off means neither channel — a bell that fills up with things
 * somebody asked not to hear about is the same noise in a quieter place. That holds
 * for the ones that are off until asked for too: nothing is recorded for somebody
 * who never turned them on (#259).
 */
export const recordAndPush =
  (deps: PushDeps, now: () => Date, log: (counts: DeliveryCounts) => void): Notifier =>
  async (accountId, told) => {
    if (!(await wants(deps.db, accountId, told.category))) return

    await deps.db.insert(notification).values({
      id: randomUUID(),
      account_id: accountId,
      category: told.category,
      body: told.body,
      link: told.link,
      created_at: now().toISOString(),
    })

    // The whole of what was told, not just the wording (#279). The row already had
    // the link and the category; the push carried neither, so the worker had nowhere
    // to send anybody and hardcoded the one page that existed when it was written.
    const counts = await notifyAccount(deps, accountId, pushPayload(told))
    if (counts.failed > 0 || counts.gone > 0) log(counts)

    return counts
  }

/**
 * Every category this account currently has on, defaults filled in.
 *
 * Computed here rather than left to the client, which would otherwise need its own
 * copy of the defaults to know what an absent row means — and a second copy of a
 * default is a default that drifts.
 */
export const switchedOn = async (db: Database, accountId: string): Promise<NotificationCategory[]> => {
  const rows = await db
    .select({ category: notificationSetting.category, enabled: notificationSetting.enabled })
    .from(notificationSetting)
    .where(eq(notificationSetting.account_id, accountId))

  const said = new Map(rows.map((row) => [row.category, row.enabled]))

  return notificationCategories.filter((category) => said.get(category) ?? notifiesByDefault(category))
}

/**
 * Somebody's name, for a notification that is about them.
 *
 * Named rather than anonymised, unlike the applications notification next door: that
 * one hides an applicant because an applicant is not a member yet and their name is
 * theirs until an admin opens the page. These go only to people attending the same
 * burn, who already read each other's names on the Members page and on the attendee
 * list — and "somebody is coming" is not worth switching on.
 */
export const displayName = async (db: Database, accountId: string): Promise<string> => {
  const [row] = await db
    .select({ name: account.name })
    .from(account)
    .where(eq(account.id, accountId))
    .limit(1)

  return row?.name ?? 'Somebody'
}

/**
 * Tell everybody coming to a burn that something happened at it (#259).
 *
 * **Attendance is the whole audience**, which is what "only for burns you are
 * attending" means: somebody who has not said they are coming hears nothing about
 * that burn, however they have set their switches. A member who leaves stops hearing
 * about it the moment their row goes.
 *
 * `except` is whoever did the thing. Never notifying somebody about their own click
 * is the rule #247 set for the roles and it applies harder here: offering your own
 * dream and being told you offered a dream is the fastest way to teach somebody that
 * the bell is noise.
 *
 * Sequential rather than `Promise.all`. It is at most forty-two people, once, and
 * each one writes a row and reaches a push service — this is the least interesting
 * place in the app to be clever about concurrency.
 */
export const notifyAttendees = async (
  db: Database,
  notify: Notifier,
  eventId: string,
  told: Told,
  { except }: { except?: string } = {},
): Promise<number> => {
  const rows = await db
    .select({ account_id: attendance.account_id })
    .from(attendance)
    .where(eq(attendance.event_id, eventId))

  let told_count = 0
  for (const row of rows) {
    if (row.account_id === except) continue
    await notify(row.account_id, told)
    told_count += 1
  }

  return told_count
}

/**
 * Tell everybody, for the one thing that is not about a burn at all.
 *
 * Every account rather than every attendee: a redeploy is the app changing under
 * whoever is using it, and an account holding `admin` without `member` is using it
 * too. The notifier drops the ones who have not asked, which is nearly everybody —
 * the category is off by default.
 */
export const notifyEveryone = async (db: Database, notify: Notifier, told: Told): Promise<number> => {
  const rows = await db.select({ id: account.id }).from(account)

  for (const row of rows) await notify(row.id, told)

  return rows.length
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

  // Counted across the whole table rather than the page above, so the bubble stays
  // right for somebody who has been away long enough to pass the limit.
  const [tally] = await db
    .select({ unseen: count() })
    .from(notification)
    .where(and(eq(notification.account_id, accountId), isNull(notification.seen_at)))

  return {
    notifications: rows satisfies Notification[],
    unseen: tally?.unseen ?? 0,
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
