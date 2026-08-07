import { describe, expect, it } from 'vitest'

import { dayName, fromLocalInput, localDay, shortDayOf, toLocalInput } from './datetime.ts'

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
 * These pin the strings. They do **not** prove the names are independent of the
 * browser, and nothing in a test can: `LC_ALL` set in-process does not move
 * Node's resolved locale — measured — so the suite cannot be made to run in
 * Swedish and catch a reversion to `toLocaleDateString` that way.
 *
 * What that costs is worth knowing rather than glossing. Reverting `dayName` to
 * the locale *is* caught, but incidentally: this runner resolves `en-US`, which
 * orders it `4 Sunday` against our `Sunday 4`. Reverting `shortDayOf` is **not**
 * caught at all — `en-US` short days are `Sat`, `Sun`, exactly what we produce.
 * Both were run to find that out.
 *
 * The independence is structural instead: `WEEKDAYS` is a literal array and no
 * `Intl` call is in reach of either function. Read it, do not trust these.
 */
describe('weekday names', () => {
  it('names the day the burn calls it', () => {
    expect(dayName('2026-10-03')).toBe('Saturday 3')
    expect(dayName('2026-10-03', 'short')).toBe('Sat 3')
    expect(dayName('2026-10-04')).toBe('Sunday 4')
  })

  it('reads the day in local time, not UTC', () => {
    // 22:00 UTC on the 3rd is midnight on the 4th in Stockholm. A calendar day
    // parsed as an instant lands on midnight UTC and slips a day westward, which
    // is why `dayName` parses at noon — this is the instant-taking sibling, where
    // the zone is genuinely part of the answer.
    expect(shortDayOf('2026-10-03T22:00:00.000Z')).toBe('Sun')
    expect(shortDayOf('2026-10-03T21:00:00.000Z')).toBe('Sat')
  })

  it('gives back what it was handed when that is not a date', () => {
    expect(dayName('not a date')).toBe('not a date')
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
