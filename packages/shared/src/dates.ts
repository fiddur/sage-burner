const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

/** Parsed at noon so no timezone can slip the day either way. */
export const dayName = (date: string, length: 'long' | 'short' = 'long'): string => {
  const at = new Date(`${date}T12:00:00`)
  if (Number.isNaN(at.getTime())) return date

  const full = WEEKDAYS[at.getDay()] ?? date

  return `${length === 'short' ? full.slice(0, 3) : full} ${at.getDate()}`
}
