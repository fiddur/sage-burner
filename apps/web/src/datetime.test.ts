import { describe, expect, it } from 'vitest'

import { fromLocalInput, localDay, localMoment, shortDayOf, todayForInput, toLocalInput } from './datetime.ts'

describe('today as a date input reads it', () => {
  it('is the reader’s own day, not UTC’s — the two differ for two hours every night here', () => {
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

describe('weekday names', () => {
  it('reads the day in local time, not UTC', () => {
    expect(shortDayOf('2026-10-03T22:00:00.000Z')).toBe('Sun')
    expect(shortDayOf('2026-10-03T21:00:00.000Z')).toBe('Sat')
  })

  it('gives back nothing when that is not a date', () => {
    expect(shortDayOf('not a date')).toBeUndefined()
  })
})

describe('the day a feed line happened', () => {
  it('reads it in local time, which is the whole reason it is not an ISO slice', () => {
    const thatYear = new Date('2026-06-01T12:00:00.000Z')

    expect(localDay('2026-10-03T22:00:00.000Z', thatYear)).toBe('4 Oct')
    expect(localDay('2026-10-03T21:00:00.000Z', thatYear)).toBe('3 Oct')
  })

  it('crosses a month, and a year, the same way', () => {
    const inThatYear = new Date('2026-11-01T12:00:00.000Z')

    expect(localDay('2026-10-31T23:00:00.000Z', inThatYear)).toBe('1 Nov')
    expect(localDay('2026-12-31T23:30:00.000Z', inThatYear)).toBe('1 Jan 2027')
  })

  it('names the year only when it is not the one the reader is in', () => {
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
    expect(localMoment('2026-08-03T12:30:00.000Z', new Date('2026-08-03'))).toBe('3 Aug 14:30')
  })

  it('names the year for a moment in another one, as the day alone does', () => {
    expect(localMoment('2025-08-03T12:30:00.000Z', new Date('2026-08-03'))).toBe('3 Aug 2025 14:30')
  })

  it('answers back what it was given when that is not a date', () => {
    expect(localMoment('not a date')).toBe('not a date')
  })
})
