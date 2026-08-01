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

/** The end of the hour a dream dropped into that row should run until. */
export const hourAfter = (row: string): string => {
  const at = new Date(row)
  at.setHours(at.getHours() + 1)

  return toLocalInput(at.toISOString())
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
