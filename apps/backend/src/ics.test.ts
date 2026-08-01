import { describe, expect, it } from 'vitest'

import { cssColor, escapeText, fold, renderCalendar, toIcsInstant } from './ics.ts'

describe('escaping', () => {
  const BACKSLASH = String.fromCharCode(92)

  it('escapes the four characters RFC 5545 reserves', () => {
    expect(escapeText('a;b')).toBe('a' + BACKSLASH + ';b')
    expect(escapeText('a,b')).toBe('a' + BACKSLASH + ',b')
    expect(escapeText('a' + BACKSLASH + 'b')).toBe('a' + BACKSLASH + BACKSLASH + 'b')
    expect(escapeText('one\ntwo')).toBe('one' + BACKSLASH + 'ntwo')
  })

  it('escapes the backslash first, so its own escape is not escaped again', () => {
    // Order matters: `\` → `\\` must run before `;` → `\;`, or the backslash the
    // second rule adds gets doubled by the first and the value arrives corrupted.
    //
    // Written with `String.fromCharCode(92)` rather than literals on purpose.
    // The first version of this file spelled the escape `'\;'`, which in
    // TypeScript is simply `';'` — so the implementation escaped nothing and the
    // expectation agreed with it. Two mistakes cancelling is exactly what a
    // literal-heavy test of escaping invites.
    expect(escapeText(BACKSLASH + ';')).toBe(BACKSLASH + BACKSLASH + BACKSLASH + ';')
  })

  it('collapses every newline spelling to one', () => {
    expect(escapeText('a\r\nb\rc\nd')).toBe('a' + BACKSLASH + 'nb' + BACKSLASH + 'nc' + BACKSLASH + 'nd')
  })
})

describe('folding', () => {
  it('leaves a short line alone', () => {
    expect(fold('SUMMARY:Cacao')).toBe('SUMMARY:Cacao')
  })

  it('folds at 75 octets, continuing with a space', () => {
    const folded = fold(`SUMMARY:${'x'.repeat(100)}`)
    const [first, second] = folded.split('\r\n')

    expect(Buffer.byteLength(first ?? '', 'utf8')).toBe(75)
    expect(second?.startsWith(' ')).toBe(true)
  })

  it('counts octets rather than characters', () => {
    // 40 four-byte emoji is 160 octets but only 40 characters, so a
    // character-counted fold would emit one over-long line and call it done.
    const folded = fold(`LOCATION:${'🛕'.repeat(40)}`)

    for (const line of folded.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75)
  })

  it('never splits a character in half', () => {
    const folded = fold(`LOCATION:${'🛕'.repeat(40)}`)

    // A split multi-byte sequence decodes to U+FFFD; round-tripping catches it.
    expect(folded.replaceAll('\r\n ', '')).toBe(`LOCATION:${'🛕'.repeat(40)}`)
    expect(folded).not.toContain('�')
  })
})

describe('timestamps', () => {
  it('renders an instant in UTC basic format', () => {
    expect(toIcsInstant('2026-08-02T18:00:00.000Z')).toBe('20260802T180000Z')
  })

  it('is the same instant whether or not the reader is in summer time', () => {
    // The suite's own timezone must not reach the output. Europe/Stockholm is
    // +02:00 in August and +01:00 in January; both render as the UTC time given.
    expect(toIcsInstant('2026-08-02T18:00:00.000Z')).toBe('20260802T180000Z')
    expect(toIcsInstant('2026-01-02T18:00:00.000Z')).toBe('20260102T180000Z')
  })

  it('normalises an offset to UTC rather than emitting it verbatim', () => {
    expect(toIcsInstant('2026-08-02T20:00:00+02:00')).toBe('20260802T180000Z')
  })
})

describe('colours', () => {
  it('spells grey the way CSS3 does, or the client ignores it', () => {
    expect(cssColor('grey')).toBe('gray')
  })

  it('passes the rest through, since they are already CSS3 names', () => {
    for (const color of ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'] as const) {
      expect(cssColor(color)).toBe(color)
    }
  })
})

const NOW = new Date('2026-07-02T00:00:00.000Z')

const aCalendar = (events: Parameters<typeof renderCalendar>[0]['events']) =>
  renderCalendar({ name: 'Summer burn', events, now: NOW, domain: 'sage-burner' })

const anEvent = {
  id: 's-1',
  title: 'Cacao ceremony',
  description: 'Bring a cup.',
  starts_at: '2026-08-02T18:00:00.000Z',
  ends_at: '2026-08-02T20:00:00.000Z',
  location: '🛕 Temple',
  color: 'yellow' as const,
}

describe('the calendar', () => {
  it('wraps the events in a VCALENDAR with the required properties', () => {
    const ics = aCalendar([anEvent])

    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics).toContain('VERSION:2.0\r\n')
    expect(ics).toContain('PRODID:-//sage-burner//EN\r\n')
  })

  it('separates every line with CRLF, never a bare newline', () => {
    // A bare LF is the single most common reason a feed will not parse.
    expect(aCalendar([anEvent]).replaceAll('\r\n', '')).not.toContain('\n')
  })

  it('gives each session a stable UID so an update replaces rather than duplicates', () => {
    expect(aCalendar([anEvent])).toContain('UID:s-1@sage-burner\r\n')
  })

  it('carries the time, place and colour', () => {
    const ics = aCalendar([anEvent])

    expect(ics).toContain('DTSTART:20260802T180000Z\r\n')
    expect(ics).toContain('DTEND:20260802T200000Z\r\n')
    expect(ics).toContain('LOCATION:🛕 Temple\r\n')
    expect(ics).toContain('COLOR:yellow\r\n')
    expect(ics).toContain(`DTSTAMP:${toIcsInstant(NOW.toISOString())}\r\n`)
  })

  it('leaves out a description and a place it does not have', () => {
    // An empty DESCRIPTION line is not the same as none, and some clients render
    // it as a blank note.
    const ics = aCalendar([{ ...anEvent, description: '', location: null, color: null }])

    expect(ics).not.toContain('DESCRIPTION')
    expect(ics).not.toContain('LOCATION')
    expect(ics).not.toContain('COLOR')
  })

  it('escapes a description that would otherwise break the format', () => {
    const ics = aCalendar([{ ...anEvent, description: 'Bring: a cup; or two, please' }])

    expect(ics).toContain(
      'DESCRIPTION:Bring: a cup' +
        String.fromCharCode(92) +
        '; or two' +
        String.fromCharCode(92) +
        ', please\r\n',
    )
  })

  it('is empty of events when nothing is scheduled, but still a valid calendar', () => {
    const ics = aCalendar([])

    expect(ics).not.toContain('BEGIN:VEVENT')
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })

  it('emits no SEQUENCE, which subscription feeds do not use', () => {
    // Deliberate: SEQUENCE is for emailed invitations. A subscribed feed is
    // refetched whole and replaced by UID, and there is no version column to
    // derive an honest number from. Always-`0` would look like handling.
    expect(aCalendar([anEvent])).not.toContain('SEQUENCE')
  })
})
