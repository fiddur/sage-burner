import type { DigestChoice, NotificationCategory } from '@sage-burner/shared'

import {
  DEFAULT_DIGEST,
  detailsPage,
  notificationCategories,
  notificationCategoryInfo,
} from '@sage-burner/shared'
import { and, desc, eq, isNull } from 'drizzle-orm'

import type { Database } from '../db/index.ts'
import type { MailDeps, Posted } from './mail.ts'

import { account, notification } from '../db/schema.ts'
import { installationTitle, mailSettingsFor, post } from './mail.ts'
import { absolute, digestMessage } from './messages.ts'

export type Repeating = Exclude<DigestChoice, 'off'>

const DAY_MS = 24 * 60 * 60 * 1000

export const digestWindowMs = (choice: Repeating): number => (choice === 'daily' ? DAY_MS : 7 * DAY_MS)

export const NIGHT_HOURS: readonly number[] = [2, 3, 4]

export const MOST_PER_SECTION = 5

const HOUR_MS = 60 * 60 * 1000

export const isNightHour = (hour: number): boolean => NIGHT_HOURS.includes(hour)

export interface DigestCandidate {
  account_id: string
  email: string
  choice: Repeating
  since: string | null
  lastActive: string | null
}

export interface DigestSection {
  category: NotificationCategory
  label: string
  total: number
  entries: { body: string; link: string | undefined }[]
}

const isRepeating = (choice: DigestChoice): choice is Repeating => choice !== 'off'

const away = (stamp: string | null, edge: string): boolean => stamp === null || stamp < edge

export const dueForDigest = async (db: Database, at: Date): Promise<DigestCandidate[]> => {
  const rows = await db
    .select({
      id: account.id,
      email: account.email,
      digest: account.digest,
      last_active_at: account.last_active_at,
      digest_sent_at: account.digest_sent_at,
    })
    .from(account)

  return rows.flatMap((row) => {
    const choice = row.digest ?? DEFAULT_DIGEST
    if (!isRepeating(choice)) return []

    const window = digestWindowMs(choice)
    if (!away(row.last_active_at, new Date(at.getTime() - window).toISOString())) return []
    if (!away(row.digest_sent_at, new Date(at.getTime() - window + HOUR_MS).toISOString())) return []

    return [
      {
        account_id: row.id,
        email: row.email,
        choice,
        since: row.digest_sent_at,
        lastActive: row.last_active_at,
      },
    ]
  })
}

export const unseenFor = async (
  db: Database,
  accountId: string,
  { after, since, origin }: { after: string | null; since: string | null; origin: string | undefined },
): Promise<DigestSection[]> => {
  const rows = await db
    .select({
      category: notification.category,
      body: notification.body,
      link: notification.link,
      created_at: notification.created_at,
    })
    .from(notification)
    .where(and(eq(notification.account_id, accountId), isNull(notification.seen_at)))
    .orderBy(desc(notification.created_at), desc(notification.id))

  if (since !== null && !rows.some((row) => row.created_at > since)) return []

  const within = after === null ? rows : rows.filter((row) => row.created_at > after)

  return notificationCategories.flatMap((category) => {
    const mine = within.filter((row) => row.category === category)
    if (mine.length === 0) return []

    return [
      {
        category,
        label: notificationCategoryInfo[category].label,
        total: mine.length,
        entries: mine.slice(0, MOST_PER_SECTION).map((row) => ({
          body: row.body,
          link: row.link === null ? undefined : absolute(origin, row.link),
        })),
      },
    ]
  })
}

export interface DigestDeps extends MailDeps {
  origin?: string
  log: (posted: Posted, accountId: string) => void
}

export const sweepDigests = async (deps: DigestDeps, at: Date): Promise<number> => {
  if ((await mailSettingsFor(deps.db)) === undefined) return 0

  const installation = await installationTitle(deps.db)
  let sent = 0

  for (const candidate of await dueForDigest(deps.db, at)) {
    const sections = await unseenFor(deps.db, candidate.account_id, {
      after: candidate.lastActive,
      since: candidate.since,
      origin: deps.origin,
    })
    if (sections.length === 0) continue

    const posted = await post(
      deps,
      digestMessage({
        installation,
        to: candidate.email,
        sections,
        settings: absolute(deps.origin, detailsPage()),
      }),
    )

    if (!posted.sent) {
      deps.log(posted, candidate.account_id)
      continue
    }

    await deps.db
      .update(account)
      .set({ digest_sent_at: at.toISOString() })
      .where(eq(account.id, candidate.account_id))
    sent += 1
  }

  return sent
}
