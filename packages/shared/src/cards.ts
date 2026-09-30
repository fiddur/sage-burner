import type { RideKind, ThreadEntityType, ThreadEntryKind } from './enums.ts'

export const whereItBelongs = (card: {
  burn: string | null
  entity_type: ThreadEntityType
}): string | undefined => card.burn ?? (card.entity_type === 'song' ? 'Songbook' : undefined)

export const rideTitle = (ride: { kind: RideKind; from: string }): string =>
  ride.kind === 'offers' ? `Offering a lift from ${ride.from}` : `Looking for a lift from ${ride.from}`

export const rideBody = (ride: { kind: RideKind; when: string; seats: number; notes: string }): string => {
  const line = ride.kind === 'offers' && ride.seats > 0 ? `${ride.when} · ${ride.seats} seats` : ride.when

  return ride.notes.trim() === '' ? line : `${line}\n\n${ride.notes}`
}

export const FOLD_AT = 5

export const folds = (kind: ThreadEntityType): boolean => kind !== 'post'

export interface FeedRow {
  id: string
  entity_type: ThreadEntityType
  last_kind: ThreadEntryKind | null
}

export type FeedItem = { id: string } | { fold: { entity_type: ThreadEntityType; thread_ids: string[] } }

const foldable = (row: FeedRow): boolean => folds(row.entity_type) && row.last_kind !== 'comment'

const joins = (run: readonly FeedRow[], row: FeedRow): boolean => {
  const [first] = run

  return first !== undefined && foldable(first) && foldable(row) && first.entity_type === row.entity_type
}

export const foldRuns = (rows: readonly FeedRow[]): FeedItem[] => {
  const runs: FeedRow[][] = []
  for (const row of rows) {
    const last = runs.at(-1)
    if (last !== undefined && joins(last, row)) last.push(row)
    else runs.push([row])
  }

  return runs.flatMap((run): FeedItem[] => {
    const [first] = run
    if (first === undefined || !foldable(first) || run.length < FOLD_AT) {
      return run.map((row) => ({ id: row.id }))
    }

    return [{ fold: { entity_type: first.entity_type, thread_ids: run.map((row) => row.id) } }]
  })
}

export const foldPhrase = {
  session: 'dreams',
  attendance: 'people coming',
  post: 'announcements',
  song: 'songs',
  bring: 'things on the bring list',
  point: 'talking points',
  meeting: 'meetings',
  role: 'lead roles',
  meal: 'meals',
  ride: 'journeys',
  build: 'build projects',
  faq: 'questions',
} as const satisfies Record<ThreadEntityType, string>

export const foldHead = (kind: ThreadEntityType, count: number): string => `${count} ${foldPhrase[kind]}`
