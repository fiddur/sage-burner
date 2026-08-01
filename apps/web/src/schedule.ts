import { toLocalInput } from './datetime.ts'

/**
 * The rows of the timetable: every hour of the burn, as local wall-clock time.
 *
 * Built from the event's calendar days rather than from any instant, because
 * that is what an organiser means by "the burn runs the 1st to the 5th" — the
 * whole of both days, in the timezone they are standing in.
 */
export const hoursOf = (startDate: string, endDate: string): string[] => {
  const first = new Date(`${startDate}T00:00`)
  const last = new Date(`${endDate}T00:00`)
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime()) || last < first) return []

  const rows: string[] = []
  for (const day = new Date(first); day <= last; day.setDate(day.getDate() + 1)) {
    for (let hour = 0; hour < 24; hour += 1) {
      const at = new Date(day)
      at.setHours(hour, 0, 0, 0)
      rows.push(toLocalInput(at.toISOString()))
    }
  }

  // Deduplicated for the hour that does not exist on the spring-forward day:
  // `setHours(2)` there lands on 03:00, so 03:00 would otherwise appear twice
  // and two rows would share a key. Checked in Europe/Stockholm, which the web
  // suite is pinned to. On the autumn day the repeated hour collapses to one
  // row, which is the right amount of attention to pay it.
  return [...new Set(rows)]
}

/**
 * Which row an instant belongs in.
 *
 * Truncating the local string is safe in a way truncating the ISO one is not —
 * the conversion to wall-clock time has already happened.
 */
export const hourOf = (iso: string | null): string | undefined => {
  if (iso === null) return undefined

  const local = toLocalInput(iso)

  return local === '' ? undefined : `${local.slice(0, 13)}:00`
}

/**
 * The calendar day after this one.
 *
 * The grid runs one day past the burn's `end_date`, because a burn's last night
 * regularly carries into the small hours of the day after — a dream at 01:00 is
 * part of the burn whatever the calendar says.
 */
export const dayAfter = (date: string): string => {
  const at = new Date(`${date}T00:00`)
  if (Number.isNaN(at.getTime())) return date
  at.setDate(at.getDate() + 1)

  return toLocalInput(at.toISOString()).slice(0, 10)
}

/** Where a dream ends when it is dropped into `row`, keeping the length it had. */
export const endFor = (
  row: string,
  dream: { time_slot_start: string | null; time_slot_end: string | null },
) => {
  const hour = 60 * 60 * 1000
  const kept =
    dream.time_slot_start === null || dream.time_slot_end === null
      ? hour
      : Date.parse(dream.time_slot_end) - Date.parse(dream.time_slot_start)

  const at = new Date(row)
  at.setTime(at.getTime() + (kept > 0 ? kept : hour))

  return at.toISOString()
}

/**
 * How many rows a dream covers, counting from the row it starts in.
 *
 * Counted against the rows themselves rather than by dividing the duration, so a
 * dream that runs past the end of the grid is clamped to what there is, and one
 * shorter than an hour still occupies its row.
 */
export const rowSpanOf = (rows: readonly string[], startIso: string, endIso: string): number => {
  const from = rows.indexOf(hourOf(startIso) ?? '')
  if (from < 0) return 0

  const endsAt = Date.parse(endIso)
  let span = 0
  for (let at = from; at < rows.length; at += 1) {
    const rowStart = new Date(rows[at] ?? '').getTime()
    if (Number.isNaN(rowStart) || rowStart >= endsAt) break
    span += 1
  }

  return Math.max(span, 1)
}

export type LaneCell =
  | { kind: 'anchor'; dreams: Placed[]; span: number }
  | { kind: 'covered' }
  | { kind: 'empty' }

export interface Placed {
  id: string
  title: string
  time_slot_start: string | null
  time_slot_end: string | null
}

/**
 * One lane's column, as table cells.
 *
 * A dream occupies every row it runs through, which is what makes a timetable a
 * timetable — a two-hour session drawn in one row reads as an hour long, which is
 * exactly what it was mistaken for.
 *
 * `rowSpan` means the rows underneath must render no cell at all, or the whole
 * column shifts sideways. Hence `covered`. Two dreams starting in the same hour
 * share a cell; one starting inside another's block joins the block rather than
 * being dropped, because an overlap is an organiser's mistake to see, not the
 * app's to hide.
 */
export const laneCells = (rows: readonly string[], dreams: readonly Placed[]): LaneCell[] => {
  const byRow = new Map<number, Placed[]>()
  for (const dream of dreams) {
    const at = rows.indexOf(hourOf(dream.time_slot_start) ?? '')
    if (at < 0) continue
    byRow.set(at, [...(byRow.get(at) ?? []), dream])
  }

  const cells: LaneCell[] = rows.map(() => ({ kind: 'empty' }))
  let coveredUntil = -1
  let anchoredAt = -1

  for (let at = 0; at < rows.length; at += 1) {
    const here = byRow.get(at) ?? []

    if (at <= coveredUntil) {
      const anchor = cells[anchoredAt]
      if (here.length > 0 && anchor?.kind === 'anchor') {
        anchor.dreams.push(...here)
        const reach = here.map(
          (dream) =>
            at - anchoredAt + rowSpanOf(rows, dream.time_slot_start ?? '', dream.time_slot_end ?? ''),
        )
        anchor.span = Math.min(Math.max(anchor.span, ...reach), rows.length - anchoredAt)
        coveredUntil = anchoredAt + anchor.span - 1
      }
      cells[at] = { kind: 'covered' }
      continue
    }

    if (here.length === 0) continue

    const span = Math.min(
      Math.max(...here.map((d) => rowSpanOf(rows, d.time_slot_start ?? '', d.time_slot_end ?? ''))),
      rows.length - at,
    )
    cells[at] = { kind: 'anchor', dreams: [...here], span }
    anchoredAt = at
    coveredUntil = at + span - 1
  }

  return cells
}
