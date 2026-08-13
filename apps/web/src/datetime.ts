const pad = (value: number) => String(value).padStart(2, '0')

export const toLocalInput = (iso: string | null): string => {
  if (iso === null) return ''

  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''

  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}

export const fromLocalInput = (local: string): string | null => {
  if (local.trim() === '') return null

  const at = new Date(local)

  return Number.isNaN(at.getTime()) ? null : at.toISOString()
}

/** Today as a `<input type="date">` reads one, in the reader's own timezone rather than UTC. */
export const todayForInput = (now: Date = new Date()): string =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

export const dayName = (date: string, length: 'long' | 'short' = 'long'): string => {
  const at = new Date(`${date}T12:00:00`)
  if (Number.isNaN(at.getTime())) return date

  const full = WEEKDAYS[at.getDay()] ?? date

  return `${length === 'short' ? full.slice(0, 3) : full} ${at.getDate()}`
}

export const shortDayOf = (iso: string): string | undefined => {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return undefined

  return WEEKDAYS[at.getDay()]?.slice(0, 3)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

export const localDay = (iso: string, today: Date = new Date()): string => {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso

  const year = at.getFullYear() === today.getFullYear() ? '' : ` ${at.getFullYear()}`

  return `${at.getDate()} ${MONTHS[at.getMonth()] ?? ''}${year}`.trim()
}

/** A day and a clock time in the reader's own timezone, which is the only one they can act in. */
export const localMoment = (iso: string, today: Date = new Date()): string => {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso

  return `${localDay(iso, today)} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}
