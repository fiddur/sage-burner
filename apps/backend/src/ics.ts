import type { PlaceColor } from '@sage-burner/shared'

/**
 * iCalendar rendering, by hand.
 *
 * RFC 5545 is mostly about three things — escaping, folding and time — and each
 * has a way of looking done while being wrong. The functions below are separate
 * and pure so each can be tested on its own rather than by reading a rendered
 * calendar and hoping.
 */

/** RFC 5545 §3.3.11. Backslash first, or the escapes it adds get escaped again. */
export const escapeText = (value: string): string =>
  value
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll(/\r\n|\r|\n/g, '\\n')

/**
 * RFC 5545 §3.1: no line over 75 **octets**, continued with CRLF and a space.
 *
 * Octets, not characters, and the difference is not academic here — a place
 * emoji is four bytes, so a line counted in characters can be well over the
 * limit. Multi-byte sequences are never split across a fold.
 */
export const fold = (line: string): string => {
  const bytes = Buffer.from(line, 'utf8')
  if (bytes.length <= 75) return line

  const parts: string[] = []
  let at = 0
  let limit = 75
  while (at < bytes.length) {
    let take = Math.min(limit, bytes.length - at)
    // Never cut mid-character: continuation bytes are 10xxxxxx.
    while (take > 1 && (bytes[at + take] ?? 0) >= 0x80 && (bytes[at + take] ?? 0) < 0xc0) take -= 1

    parts.push(bytes.subarray(at, at + take).toString('utf8'))
    at += take
    // Subsequent lines carry a leading space, which counts towards the 75.
    limit = 74
  }

  return parts.join('\r\n ')
}

/**
 * An ISO instant as an iCalendar UTC timestamp.
 *
 * `Z` form throughout, so there is no `VTIMEZONE` to emit and nothing to get
 * wrong across a DST boundary: an instant is an instant, and the calendar client
 * renders it in whatever zone the reader is in. Converting to Europe/Stockholm
 * here would mean shipping timezone rules that go stale.
 */
export const toIcsInstant = (iso: string): string =>
  new Date(iso)
    .toISOString()
    .replaceAll(/[-:]/g, '')
    .replace(/\.\d{3}/, '')

/**
 * Our palette as CSS3 colour names, which is what RFC 7986 `COLOR` takes.
 *
 * `grey` is the one that matters: CSS3 spells it `gray`, and a name outside the
 * list is simply ignored by a client, so the lane would lose its colour with
 * nothing to indicate why.
 */
export const cssColor = (color: PlaceColor): string => (color === 'grey' ? 'gray' : color)

export interface CalendarEvent {
  id: string
  title: string
  description: string
  starts_at: string
  ends_at: string
  location: string | null
  color: PlaceColor | null
}

export interface CalendarInput {
  name: string
  events: readonly CalendarEvent[]
  /** Stamped on every event, so a client can tell one fetch from another. */
  now: Date
  /** The `UID` suffix, which RFC 5545 wants to look like a domain. */
  domain: string
}

const event = (
  { id, title, description, starts_at, ends_at, location, color }: CalendarEvent,
  input: CalendarInput,
) => [
  'BEGIN:VEVENT',
  // Stable per session, so a client replaces rather than duplicates.
  `UID:${id}@${input.domain}`,
  `DTSTAMP:${toIcsInstant(input.now.toISOString())}`,
  `DTSTART:${toIcsInstant(starts_at)}`,
  `DTEND:${toIcsInstant(ends_at)}`,
  `SUMMARY:${escapeText(title)}`,
  ...(description === '' ? [] : [`DESCRIPTION:${escapeText(description)}`]),
  ...(location === null ? [] : [`LOCATION:${escapeText(location)}`]),
  ...(color === null ? [] : [`COLOR:${cssColor(color)}`]),
  'END:VEVENT',
]

/**
 * The whole calendar, CRLF-terminated.
 *
 * No `SEQUENCE`. It exists for iTIP — emailed invitations, where a client has to
 * tell a newer copy of one event from an older one. A subscription feed is
 * refetched whole and replaced by `UID`, so there is nothing for it to decide,
 * and there is no version column to derive an honest number from anyway. Better
 * absent than always `0`, which would look like handling and be none.
 */
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
