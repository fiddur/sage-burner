import { describe, expect, it } from 'vitest'

import { dayAfter, hourOf, hoursOf } from './schedule.ts'

describe('the timetable rows', () => {
  it('covers every hour of every day of the burn', () => {
    const rows = hoursOf('2026-08-01', '2026-08-03')

    expect(rows).toHaveLength(72)
    expect(rows[0]).toBe('2026-08-01T00:00')
    expect(rows[23]).toBe('2026-08-01T23:00')
    expect(rows[71]).toBe('2026-08-03T23:00')
  })

  it('covers a single-day burn', () => {
    expect(hoursOf('2026-08-01', '2026-08-01')).toHaveLength(24)
  })

  it('crosses a month boundary rather than stopping at the 31st', () => {
    const rows = hoursOf('2026-07-31', '2026-08-01')

    expect(rows).toHaveLength(48)
    expect(rows[24]).toBe('2026-08-01T00:00')
  })

  it('does not repeat an hour on the day the clocks go forward', () => {
    // 2026-03-29 in Europe/Stockholm, which the suite is pinned to: 02:00 does
    // not exist, and `setHours(2)` lands on 03:00. Without deduplication two
    // rows share a key and a dream at 03:00 renders twice.
    const rows = hoursOf('2026-03-29', '2026-03-29')

    expect(rows).toEqual([...new Set(rows)])
    expect(rows).toHaveLength(23)
  })

  it('is 144 rows for a five-day burn, which is the number the README quotes', () => {
    // The README states this figure, and a figure in prose goes stale silently.
    // `Schedule.tsx` passes `dayAfter(end_date)`, so the 1st to the 5th is six
    // days of rows rather than five.
    expect(hoursOf('2026-08-01', dayAfter('2026-08-05'))).toHaveLength(144)
  })

  it('is empty for dates that make no sense, rather than looping forever', () => {
    expect(hoursOf('2026-08-05', '2026-08-01')).toEqual([])
    expect(hoursOf('not a date', '2026-08-01')).toEqual([])
  })
})

describe('placing a dream in a row', () => {
  it('finds the row for an instant, in local time', () => {
    // Pinned to Europe/Stockholm by `vite.config.ts`: 18:00Z in August is 20:00
    // local, so the dream belongs in the 20:00 row and not the 18:00 one.
    expect(hourOf('2026-08-02T18:00:00.000Z')).toBe('2026-08-02T20:00')
  })

  it('rounds down to the hour, so a dream at 20:30 is in the 20:00 row', () => {
    expect(hourOf('2026-08-02T18:30:00.000Z')).toBe('2026-08-02T20:00')
  })

  it('places nothing for a dream that is not scheduled', () => {
    expect(hourOf(null)).toBeUndefined()
  })
})
