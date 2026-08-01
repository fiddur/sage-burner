import { toLocalInput } from './datetime.ts'

/**
 * The rows of the timetable: every hour the burn is open, as local wall-clock
 * time.
 *
 * The organiser's own hours, not a guess. The first row is the hour the start
 * time falls in — arriving at 15:30 means the 15:00 row — and the last is the
 * hour containing the end. A burn that runs midday Friday to midday Sunday is
 * 49 rows rather than three whole days.
 *
 * Walking by hours rather than by days also removes the spring-forward problem
 * that deduplication used to paper over: adding an hour to an instant crosses the
 * missing 02:00 exactly once, so the hour that does not exist never appears.
 */
export const hoursOf = (
  startDate: string,
  endDate: string,
  startTime = '00:00',
  endTime = '23:59',
): string[] => {
  const first = new Date(`${startDate}T${startTime}`)
  const last = new Date(`${endDate}T${endTime}`)
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime()) || last < first) return []

  const rows: string[] = []
  const at = new Date(first)
  at.setMinutes(0, 0, 0)
  while (at <= last) {
    rows.push(toLocalInput(at.toISOString()))
    at.setHours(at.getHours() + 1)
  }

  return rows
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
