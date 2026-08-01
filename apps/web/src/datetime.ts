/**
 * Between the API's UTC instants and what `<input type="datetime-local">` speaks.
 *
 * The input has no timezone at all: it reads and writes `YYYY-MM-DDTHH:mm` in
 * whatever zone the browser is in. The API stores and transports UTC. So both
 * directions are a conversion, not a reformat, and doing it by slicing the ISO
 * string — which is the obvious-looking shortcut — silently shows a Swedish
 * organiser 16:00 for an 18:00 dream every summer.
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
