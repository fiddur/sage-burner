import { toLocalInput } from './datetime.ts'

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

export const hourOf = (iso: string | null): string | undefined => {
  if (iso === null) return undefined

  const local = toLocalInput(iso)

  return local === '' ? undefined : `${local.slice(0, 13)}:00`
}

const HOUR = 60 * 60 * 1000

export const rowsDragged = (deltaY: number, rowHeight: number): number =>
  rowHeight > 0 ? Math.round(deltaY / rowHeight) : 0

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

export type MealPart = 'clean' | 'cook' | 'serve'

const OFFSET_HOURS: Record<MealPart, number> = { cook: -2, serve: 0, clean: 1 }

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

export const mealMovedTo = (part: MealPart, row: string): { date: string; at: string } | undefined => {
  const at = new Date(row)
  if (Number.isNaN(at.getTime())) return undefined

  at.setHours(at.getHours() - OFFSET_HOURS[part])
  const local = toLocalInput(at.toISOString())

  return local === '' ? undefined : { date: local.slice(0, 10), at: local.slice(11) }
}
