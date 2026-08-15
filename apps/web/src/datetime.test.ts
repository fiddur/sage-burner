import { describe, expect, it } from 'vitest'

import { fromLocalInput, localDay, localMoment, shortDayOf, todayForInput, toLocalInput } from './datetime.ts'

describe('today as a date input reads it', () => {
  it('is the reader’s own day, not UTC’s — the two differ for two hours every night here', () => {
    // `vite.config.ts` pins TZ=Europe/Stockholm, where 00:30 local on the 2nd is still the 1st
    // in UTC. A `min` taken from the UTC day would refuse a date the reader can see is tomorrow.
    expect(todayForInput(new Date('2026-08-01T22:30:00.000Z'))).toBe('2026-08-02')
  })

  it('pads a single-digit month and day, which is what the input expects', () => {
    expect(todayForInput(new Date('2026-01-05T12:00:00.000Z'))).toBe('2026-01-05')
  })
})

describe('datetime-local conversion', () => {
  it('round-trips an instant through the input and back', () => {
    const iso = '2026-08-02T18:00:00.000Z'

    expect(fromLocalInput(toLocalInput(iso))).toBe(iso)
  })

  it('shows the local wall clock, not the UTC one', () => {
    // A literal, which is only safe because `vite.config.ts` pins the suite to
    // Europe/Stockholm. In UTC every wrong implementation looks right here, so
    // running this suite in UTC would silently stop testing anything.
    expect(toLocalInput('2026-08-02T18:00:00.000Z')).toBe('2026-08-02T20:00')
    expect(fromLocalInput('2026-08-02T20:00')).toBe('2026-08-02T18:00:00.000Z')
  })

  it('produces exactly the shape the input accepts', () => {
    expect(toLocalInput('2026-08-02T18:00:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })

  it('is not a substring of the ISO text, which is the tempting shortcut', () => {
    const iso = '2026-08-02T18:00:00.000Z'

    expect(toLocalInput(iso)).not.toBe(iso.slice(0, 16))
  })

  it('treats an empty box as no time at all', () => {
    expect(fromLocalInput('')).toBeNull()
    expect(fromLocalInput('   ')).toBeNull()
    expect(toLocalInput(null)).toBe('')
  })

  it('does not turn nonsense into an instant', () => {
    expect(fromLocalInput('not a date')).toBeNull()
    expect(toLocalInput('not a date')).toBe('')
  })
})

/**
 * This pins the strings. It does **not** prove the names are independent of the
 * browser, and nothing in a test can: `LC_ALL` set in-process does not move
 * Node's resolved locale — measured. Reverting `shortDayOf` to `toLocaleDateString`
 * is **not** caught at all: `en-US` short days are `Sat`, `Sun`, exactly what we
 * produce. That was run to find out. The independence is structural instead —
 * `WEEKDAYS` is a literal array and no `Intl` call is in reach.
 */
describe('weekday names', () => {
  it('reads the day in local time, not UTC', () => {
    // 22:00 UTC on the 3rd is midnight on the 4th in Stockholm.
    expect(shortDayOf('2026-10-03T22:00:00.000Z')).toBe('Sun')
    expect(shortDayOf('2026-10-03T21:00:00.000Z')).toBe('Sat')
  })

  it('gives back nothing when that is not a date', () => {
    expect(shortDayOf('not a date')).toBeUndefined()
  })
})

describe('the day a feed line happened', () => {
  it('reads it in local time, which is the whole reason it is not an ISO slice', () => {
    // 22:00 UTC on the 3rd is midnight on the 4th in Stockholm, so `iso.slice(0, 10)`
    // would say the 3rd — the shortcut `localDay` exists to avoid. Only a test in a zone
    // ahead of UTC can say so, which is what `vite.config.ts` pins the suite to.
    const thatYear = new Date('2026-06-01T12:00:00.000Z')

    expect(localDay('2026-10-03T22:00:00.000Z', thatYear)).toBe('4 Oct')
    expect(localDay('2026-10-03T21:00:00.000Z', thatYear)).toBe('3 Oct')
  })

  it('crosses a month, and a year, the same way', () => {
    const inThatYear = new Date('2026-11-01T12:00:00.000Z')

    expect(localDay('2026-10-31T23:00:00.000Z', inThatYear)).toBe('1 Nov')
    // Local midnight on New Year's Eve is already 1 January, and 2027 — which the
    // reader is not standing in, so it says so.
    expect(localDay('2026-12-31T23:30:00.000Z', inThatYear)).toBe('1 Jan 2027')
  })

  it('names the year only when it is not the one the reader is in', () => {
    // The page reading this spans burns, so a line from last autumn needs placing —
    // and a year on every line of this week's would be noise.
    const now = new Date('2026-08-07T12:00:00.000Z')

    expect(localDay('2026-08-07T18:00:00.000Z', now)).toBe('7 Aug')
    expect(localDay('2025-10-03T18:00:00.000Z', now)).toBe('3 Oct 2025')
  })

  it('gives back what it was handed when that is not a date', () => {
    expect(localDay('not a date')).toBe('not a date')
  })
})

describe('localMoment', () => {
  it('is a day and a clock time in the reader own timezone, the only one they can act in', () => {
    // In UTC every wrong implementation of this looks right; `vite.config.ts` pins
    // TZ=Europe/Stockholm.
    expect(localMoment('2026-08-03T12:30:00.000Z', new Date('2026-08-03'))).toBe('3 Aug 14:30')
  })

  it('names the year for a moment in another one, as the day alone does', () => {
    expect(localMoment('2025-08-03T12:30:00.000Z', new Date('2026-08-03'))).toBe('3 Aug 2025 14:30')
  })

  it('answers back what it was given when that is not a date', () => {
    expect(localMoment('not a date')).toBe('not a date')
  })
})
