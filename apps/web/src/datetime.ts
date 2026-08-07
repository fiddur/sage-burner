/**
 * Between the API's UTC instants and what `<input type="datetime-local">` speaks.
 *
 * The input has no timezone at all: it reads and writes `YYYY-MM-DDTHH:mm` in
 * whatever zone the browser is in. The API stores and transports UTC. So both
 * directions are a conversion, not a reformat, and doing it by slicing the ISO
 * string — which is the obvious-looking shortcut — silently shows a Swedish
 * admin 16:00 for an 18:00 dream every summer.
 */

const pad = (value: number) => String(value).padStart(2, '0')

/** An ISO instant as the local wall-clock time the input expects. `''` for none. */
export const toLocalInput = (iso: string | null): string => {
  if (iso === null) return ''

  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''

  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/** Local wall-clock time from the input as an ISO instant. `null` for an empty box. */
export const fromLocalInput = (local: string): string | null => {
  if (local.trim() === '') return null

  const at = new Date(local)

  return Number.isNaN(at.getTime()) ? null : at.toISOString()
}

/**
 * Written out rather than taken from `toLocaleDateString`, which follows the
 * browser: a Swedish laptop would read `lör` on a page that is English in every
 * sentence around it. Indexed by `getDay()`, so Sunday first.
 */
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

/**
 * `Saturday 3` — a day of the burn, as the meal plan's "When?" column names it.
 *
 * Parsed at noon: a calendar day has no instant of its own, and taking it as
 * midnight UTC lands on the previous day for anybody west of Greenwich.
 */
export const dayName = (date: string, length: 'long' | 'short' = 'long'): string => {
  const at = new Date(`${date}T12:00:00`)
  if (Number.isNaN(at.getTime())) return date

  const full = WEEKDAYS[at.getDay()] ?? date

  return `${length === 'short' ? full.slice(0, 3) : full} ${at.getDate()}`
}

/** `Sat` — the same names, from an instant rather than a calendar day. */
export const shortDayOf = (iso: string): string | undefined => {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return undefined

  return WEEKDAYS[at.getDay()]?.slice(0, 3)
}
