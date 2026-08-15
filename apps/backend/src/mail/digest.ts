import type { DigestChoice, FeedKind, Thread, ThreadEntry } from '@sage-burner/shared'

import { DEFAULT_DIGEST, detailsPage, feedKindLabel, feedKinds, threadEntityTypes } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'

import type { Database } from '../db/index.ts'
import type { MailDeps, Posted } from './mail.ts'

import { account } from '../db/schema.ts'
import { approvedAccounts } from '../push/notify.ts'
import { FEED_LIMIT } from '../routes/feed.ts'
import { readThreads, recentThreads } from '../routes/threads.ts'
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
  digest_sent_at: string | null
  last_active_at: string | null
}

export interface DigestSection {
  kind: FeedKind
  label: string
  total: number
  entries: { body: string; link: string | undefined }[]
}

const isRepeating = (choice: DigestChoice): choice is Repeating => choice !== 'off'

const away = (stamp: string | null, edge: string): boolean => stamp === null || stamp < edge

export const laterOf = (one: string | null, other: string | null): string | null => {
  if (one === null) return other
  if (other === null) return one

  return one > other ? one : other
}

export const dueForDigest = async (db: Database, at: Date): Promise<DigestCandidate[]> => {
  const approved = new Set(await approvedAccounts(db))

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
    if (!approved.has(row.id)) return []

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
        digest_sent_at: row.digest_sent_at,
        last_active_at: row.last_active_at,
      },
    ]
  })
}

const SOMEBODY = 'Somebody'

const talkOf = (said: number): string => `+${said} ${said === 1 ? 'comment' : 'comments'}`

const perActor = (entries: readonly ThreadEntry[]): string[] => {
  const runs: { who: string; what: string[] }[] = []

  for (const entry of entries) {
    const who = entry.author?.name ?? SOMEBODY
    const run = runs.at(-1)

    if (run?.who === who) run.what.push(entry.body)
    else runs.push({ who, what: [entry.body] })
  }

  return runs.map((run) => `${run.who} ${run.what.join(', ')}`)
}

export const lineFor = (card: Pick<Thread, 'entries' | 'title'>): string | undefined => {
  const said = card.entries.filter((entry) => entry.kind === 'comment').length
  const did = perActor(card.entries.filter((entry) => entry.kind !== 'comment'))

  if (did.length === 0 && said === 0) return undefined
  if (did.length === 0) return `${card.title} — ${talkOf(said)}`
  if (said === 0) return `${card.title} — ${did.join('; ')}`

  return `${card.title} — ${did.join('; ')} (${talkOf(said)})`
}

interface FeedLine {
  id: string
  at: string
  kind: FeedKind
  body: string
  link: string | null
}

export const feedSince = async (
  db: Database,
  { after, origin }: { after: string | null; origin: string | undefined },
): Promise<DigestSection[]> => {
  const recent = await recentThreads(db, FEED_LIMIT, threadEntityTypes)

  const cards = await readThreads(
    db,
    recent.map((one) => one.id),
    { after },
  )

  const byId = new Map(recent.map((one) => [one.id, one.last_at]))

  const said: FeedLine[] = cards.flatMap((card) => {
    const body = card.gone ? undefined : lineFor(card)
    const at = byId.get(card.id)
    if (body === undefined || at === undefined) return []

    return [{ id: card.id, at, kind: card.entity_type, body, link: card.link }]
  })

  const kept = said
    .sort((one, other) =>
      one.at === other.at ? other.id.localeCompare(one.id) : other.at.localeCompare(one.at),
    )
    .slice(0, FEED_LIMIT)

  return feedKinds.flatMap((kind) => {
    const mine = kept.filter((one) => one.kind === kind)
    if (mine.length === 0) return []

    return [
      {
        kind,
        label: feedKindLabel[kind],
        total: mine.length,
        entries: mine.slice(0, MOST_PER_SECTION).map((one) => ({
          body: one.body,
          link: one.link === null ? undefined : absolute(origin, one.link),
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
    const sections = await feedSince(deps.db, {
      after: laterOf(candidate.last_active_at, candidate.digest_sent_at),
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

export const digestPreviewFor = async (
  db: Database,
  { hours, origin }: { hours: number; origin: string | undefined },
  at: Date,
): Promise<DigestSection[]> =>
  await feedSince(db, { after: new Date(at.getTime() - hours * HOUR_MS).toISOString(), origin })
