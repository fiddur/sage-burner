import { toLocalInput } from './datetime.ts'

/**
 * The rows of the timetable: every hour the burn is open, as local wall-clock
 * time.
 *
 * The admin's own hours, not a guess. The first row is the hour the start
 * time falls in — arriving at 15:30 means the 15:00 row — and the last is the
 * hour containing the end. A burn that runs midday Friday to midday Sunday is
 * 49 rows rather than three whole days.
 *
 * Walking hour by hour also removes the deduplication the day-by-day version
 * needed. `setHours(getHours() + 1)` steps the **wall clock**, not the instant,
 * so each label appears exactly once whichever way the clocks go: the hour that
 * does not exist in spring is stepped over, and the hour that happens twice in
 * autumn gets one row. Measured in Europe/Stockholm — 23 rows on 2026-03-29, 24
 * on 2026-10-25 — and both are pinned by tests, because which of those two a
 * `Date` method gives you is not something to reason about.
 *
 * The autumn row covers two real hours. A dream in either lands in it, so nothing
 * disappears; the schedule is simply an hour vaguer for one night a year.
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

const HOUR = 60 * 60 * 1000

/** How many whole rows a pointer travelled, for a row `rowHeight` pixels tall. */
export const rowsDragged = (deltaY: number, rowHeight: number): number =>
  rowHeight > 0 ? Math.round(deltaY / rowHeight) : 0

/**
 * The end a dream gets when its bottom edge is pulled `byRows` rows.
 *
 * Whole hours, because a row is one: a grid cannot show a dream finishing at 20:40,
 * so letting somebody set that from the grid would be letting them set something
 * they cannot see. The Dreams form is where a minute-precision end is typed.
 *
 * Null when nothing changes — a drag that never crossed a boundary, or a shortening
 * that would take a dream under the hour it already is.
 */
export const resizedEnd = (
  dream: { time_slot_start: string | null; time_slot_end: string | null },
  byRows: number,
): string | null => {
  if (dream.time_slot_start === null || dream.time_slot_end === null || byRows === 0) return null

  const start = Date.parse(dream.time_slot_start)
  const hours = Math.max(1, Math.round((Date.parse(dream.time_slot_end) - start) / HOUR) + byRows)
  const end = new Date(start + hours * HOUR).toISOString()

  return end === dream.time_slot_end ? null : end
}

/** Where a dream ends when it is dropped into `row`, keeping the length it had. */
export const endFor = (
  row: string,
  dream: { time_slot_start: string | null; time_slot_end: string | null },
) => {
  const kept =
    dream.time_slot_start === null || dream.time_slot_end === null
      ? HOUR
      : Date.parse(dream.time_slot_end) - Date.parse(dream.time_slot_start)

  const at = new Date(row)
  at.setTime(at.getTime() + (kept > 0 ? kept : HOUR))

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
 * being dropped, because an overlap is an admin's mistake to see, not the
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

export interface MealBlock {
  id: string
  title: string
  time_slot_start: string
  time_slot_end: string
  meal_id: string
  part: MealPart
}

/**
 * Which of a meal's three blocks this is.
 *
 * The offsets are what makes a drag land where it was dropped: pull the cooking
 * block to 12:00 and the meal is at 14:00, because cooking is the two hours before.
 */
export type MealPart = 'clean' | 'cook' | 'serve'

const OFFSET_HOURS: Record<MealPart, number> = { cook: -2, serve: 0, clean: 1 }

/**
 * The blocks one sitting draws in the kitchen lane.
 *
 * Two hours cooking, the hour of eating, the hour washing up — the shape a burn's
 * kitchen actually runs on. A `chore` draws one block of its own hour instead:
 * cooking for a morning cleanup is nonsense.
 *
 * `date` and `at` are local wall-clock, which is what the grid's rows are; the ends
 * come back as instants, which is what everything else on the page speaks.
 */
export const mealBlocks = (meal: {
  id: string
  date: string
  at: string
  label: string
  kind: 'chore' | 'meal'
}): MealBlock[] => {
  const at = new Date(`${meal.date}T${meal.at}`)
  if (Number.isNaN(at.getTime())) return []

  const hour = 60 * 60 * 1000
  const from = (hours: number) => new Date(at.getTime() + hours * hour).toISOString()
  const block = (part: MealPart, title: string, start: number, end: number): MealBlock => ({
    id: `${meal.id}:${part}`,
    meal_id: meal.id,
    part,
    title,
    time_slot_start: from(start),
    time_slot_end: from(end),
  })

  if (meal.kind === 'chore') return [block('serve', meal.label, 0, 1)]

  return [
    block('cook', `Cooking · ${meal.label}`, -2, 0),
    block('serve', meal.label, 0, 1),
    block('clean', `Cleanup · ${meal.label}`, 1, 2),
  ]
}

/**
 * Where a meal ends up when one of its blocks is dropped on `row`.
 *
 * The block lands where it was put and the meal follows, so dropping the cleanup
 * block on 15:00 means a 14:00 meal. Local wall-clock both ways — a meal is stored
 * as a date and a clock time, not as an instant.
 */
export const mealMovedTo = (part: MealPart, row: string): { date: string; at: string } | undefined => {
  const at = new Date(row)
  if (Number.isNaN(at.getTime())) return undefined

  at.setHours(at.getHours() - OFFSET_HOURS[part])
  const local = toLocalInput(at.toISOString())

  return local === '' ? undefined : { date: local.slice(0, 10), at: local.slice(11) }
}
