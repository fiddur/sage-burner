import type { PlaceColor, PublicSession } from '@sage-burner/shared'

export const escapeText = (value: string): string =>
  value
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll(/\r\n|\r|\n/g, '\\n')

export const fold = (line: string): string => {
  const bytes = Buffer.from(line, 'utf8')
  if (bytes.length <= 75) return line

  const parts: string[] = []
  let at = 0
  let limit = 75
  while (at < bytes.length) {
    let take = Math.min(limit, bytes.length - at)
    while (take > 1 && (bytes[at + take] ?? 0) >= 0x80 && (bytes[at + take] ?? 0) < 0xc0) take -= 1

    parts.push(bytes.subarray(at, at + take).toString('utf8'))
    at += take
    limit = 74
  }

  return parts.join('\r\n ')
}

export const toIcsInstant = (iso: string): string =>
  new Date(iso)
    .toISOString()
    .replaceAll(/[-:]/g, '')
    .replace(/\.\d{3}/, '')

export const cssColor = (color: PlaceColor): string => (color === 'grey' ? 'gray' : color)

export type CalendarEvent = PublicSession

export interface CalendarInput {
  name: string
  events: readonly CalendarEvent[]
  now: Date
  domain: string
}

const event = (
  { id, title, description, time_slot_start, time_slot_end, location, color }: CalendarEvent,
  input: CalendarInput,
) => [
  'BEGIN:VEVENT',
  `UID:${id}@${input.domain}`,
  `DTSTAMP:${toIcsInstant(input.now.toISOString())}`,
  `DTSTART:${toIcsInstant(time_slot_start)}`,
  `DTEND:${toIcsInstant(time_slot_end)}`,
  `SUMMARY:${escapeText(title)}`,
  ...(description === '' ? [] : [`DESCRIPTION:${escapeText(description)}`]),
  ...(location === null ? [] : [`LOCATION:${escapeText(location)}`]),
  ...(color === null ? [] : [`COLOR:${cssColor(color)}`]),
  'END:VEVENT',
]

export const renderCalendar = (input: CalendarInput): string =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//sage-burner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(input.name)}`,
    ...input.events.flatMap((entry) => event(entry, input)),
    'END:VCALENDAR',
  ]
    .map(fold)
    .join('\r\n')
    .concat('\r\n')
