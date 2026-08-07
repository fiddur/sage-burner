import type { Notification, NotificationCategory } from '@sage-burner/shared'

import { notificationCategories, notifiesByDefault } from '@sage-burner/shared'
import { and, count, desc, eq, isNull } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { Database } from '../db/index.ts'
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

/** What a route says happened. The wording and the page it belongs to. */
export interface Told {
  category: NotificationCategory
  body: string
  /** A path in this app. Null for anything with no page of its own. */
  link: string | null
}

export type Notifier = (accountId: string, told: Told) => Promise<unknown>

/**
 * Posting one notification to somebody who asked for it by email (#30).
 *
 * Injected rather than built here, so `notify.ts` stays free of both the mail
 * settings and the installation's name — and so an installation with no SMTP server
 * passes nothing and this whole branch costs a comparison.
 */
export type EmailChannel = (accountId: string, told: Told) => Promise<unknown>

/**
 * What a push carries, and the one place it is built (#279).
 *
 * The whole of what was told, which is the same thing the bell row holds — there is
 * one sender now that the applications push writes a row like everything else (#326),
 * so a push cannot carry less than the row it copies.
 */
export const pushPayload = ({ body, link, category }: Told): string =>
  JSON.stringify({ body, link, category })

/** Which ways this person wants to hear about one category. */
export interface Channels {
  /** The bell, and the push that copies it. */
  bell: boolean
  email: boolean
}

/**
 * Whether this person wants to hear about this, and how.
 *
 * A stored row is what they said; absence is that they have not said, and the
 * default answers instead. That indirection is the whole reason the table carries
 * `enabled` rather than only listing mutes — six categories are on unless refused
 * and five are off unless asked for, and "is there a row" cannot mean both (#259).
 *
 * Email needs no such indirection: it is off for every category until somebody asks,
 * so absence and `false` say the same thing (#30). The two channels are independent
 * — somebody may want the burn-wide ones in their inbox and not on their phone —
 * which is why this answers with both rather than with one switch and a channel.
 */
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

/**
 * Tell somebody something happened to them (#248).
 *
 * The row is written first and the push is a copy of it, which is the order that
 * matters: a push service being unreachable must not cost somebody the record, and
 * the bell is the surface that is always there. A member with no subscription gets
 * the bell and nothing else, which is the ordinary case.
 *
 * A category somebody has switched off is not written at all — a bell that fills up
 * with things somebody asked not to hear about is the same noise in a quieter place.
 * That holds for the ones that are off until asked for too: nothing is recorded for
 * somebody who never turned them on (#259).
 *
 * **Email is a channel of its own, not a copy of the bell** (#30). The two switches
 * are independent, so somebody may take the burn-wide ones in their inbox and off
 * their phone — and switching the bell off is then not also an instruction to stop
 * posting. It is started before the row is written and awaited after, so a mail
 * server that is slow costs nobody their record.
 */
export const recordAndPush =
  (
    deps: PushDeps,
    now: () => Date,
    log: (counts: DeliveryCounts) => void,
    byEmail?: EmailChannel,
  ): Notifier =>
  async (accountId, told) => {
    const channels = await wants(deps.db, accountId, told.category)

    // Independent of the bell, and after it: somebody may want the burn-wide ones in
    // their inbox and nowhere else, and the write must not fail because a mail server
    // did — the rule push already follows here (#30).
    const posting = channels.email && byEmail !== undefined ? byEmail(accountId, told) : undefined

    if (!channels.bell) return await posting

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

    await posting

    return counts
  }

/**
 * Every category this account currently has on, per channel, defaults filled in.
 *
 * Computed here rather than left to the client, which would otherwise need its own
 * copy of the defaults to know what an absent row means — and a second copy of a
 * default is a default that drifts.
 */
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
    // No default to fill in: email is off until asked for, so absence is `false`.
    email: notificationCategories.filter((category) => said.get(category)?.email ?? false),
  }
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
 * One line in the feed, for something that happened at a burn (#303).
 *
 * Written where the burn-wide notification is sent and nowhere else, which is what
 * keeps the two describing one event the same way — and written whether or not anybody
 * has that category switched on, because that is the whole point of the feed: most of
 * these are off by default, so the ordinary way to learn somebody offered a dream was
 * to go looking at the schedule.
 *
 * Belongs to nobody, unlike a notification. Nothing reads it per account and reading
 * the feed writes nothing.
 */
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

/**
 * Tell everybody coming to a burn that something happened at it (#259), and put it in
 * the feed (#303).
 *
 * **Attendance is the whole audience**, which is what "only for burns you are
 * attending" means: somebody who has not said they are coming hears nothing about
 * that burn, however they have set their switches. A member who leaves stops hearing
 * about it the moment their row goes.
 *
 * `except` is whoever the burn-wide note would be noise for. Whoever did the thing,
 * always — never notifying somebody about their own click is the rule #247 set for
 * the roles, and it applies harder here: offering your own dream and being told you
 * offered a dream is the fastest way to teach somebody the bell is noise. A **list**,
 * because appointing somebody makes them the subject as well, and they already have
 * the personal "You are now Kitchen lead" (#270).
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
  { except = [], at }: { at: Date; except?: readonly (string | undefined)[] },
): Promise<number> => {
  // Before the fan-out, and outside it: the feed line is one row for the burn, not one
  // per person, and it is there even when nobody is coming yet or everybody has the
  // category off.
  await recordActivity(db, eventId, told, at)

  const rows = await db
    .select({ account_id: attendance.account_id })
    .from(attendance)
    .where(eq(attendance.event_id, eventId))

  const silent = new Set(except)

  let told_count = 0
  for (const row of rows) {
    if (silent.has(row.account_id)) continue
    await notify(row.account_id, told)
    told_count += 1
  }

  return told_count
}

/**
 * Tell every admin about something they look after (#326).
 *
 * An application is the one thing notified about that is nobody's personally and not a
 * burn's either: it is a job waiting for whoever reviews applications. The category is
 * `about: 'admin'`, so only an admin is offered the switch — and it is on by default,
 * because an application nobody sees leaves the applicant waiting.
 *
 * Every admin account, not every subscribed admin: the row is the point, and a push is
 * a copy of it. An installation with nobody subscribed still fills the bell.
 */
export const notifyAdmins = async (db: Database, notify: Notifier, told: Told): Promise<number> => {
  const rows = await db
    .select({ account_id: accountRole.account_id })
    .from(accountRole)
    .where(eq(accountRole.role, 'admin'))

  for (const row of rows) await notify(row.account_id, told)

  return rows.length
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
