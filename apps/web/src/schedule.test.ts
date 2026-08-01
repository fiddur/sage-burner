import { describe, expect, it } from 'vitest'

import { hourOf, hoursOf, laneCells, rowSpanOf } from './schedule.ts'

describe('the timetable rows', () => {
  it('covers every hour of every day when the burn runs the whole days', () => {
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
    // not exist. Stepping the wall clock crosses the gap once, so no row repeats
    // and none is invented. Setting hours on a date instead lands on 03:00 twice,
    // which is what makes this worth asserting.
    const rows = hoursOf('2026-03-29', '2026-03-29')

    expect(rows).toEqual([...new Set(rows)])
    expect(rows).toHaveLength(23)
  })

  it('is 49 rows for midday Friday to midday Sunday, the figure the README quotes', () => {
    // A number in prose goes stale silently, so it is asserted here.
    expect(hoursOf('2026-08-01', '2026-08-03', '12:00', '12:00')).toHaveLength(49)
  })

  it('starts at the hour the burn opens, not at midnight', () => {
    const rows = hoursOf('2026-08-01', '2026-08-01', '15:30', '22:00')

    expect(rows[0]).toBe('2026-08-01T15:00')
    expect(rows.at(-1)).toBe('2026-08-01T22:00')
  })

  it('runs past midnight when the burn does, without an extra day of empties', () => {
    // What `dayAfter` used to guess at. The organiser says 04:00 on the 3rd and
    // gets exactly that.
    const rows = hoursOf('2026-08-01', '2026-08-03', '18:00', '04:00')

    expect(rows[0]).toBe('2026-08-01T18:00')
    expect(rows.at(-1)).toBe('2026-08-03T04:00')
  })

  it('does not repeat an hour on the day the clocks go back', () => {
    // The other direction, and the one the removed deduplication also covered.
    // 2026-10-25 has 25 real hours in Europe/Stockholm, two of them 02:00.
    // Stepping the wall clock gives one row per label, so nothing collides as a
    // key — checked rather than assumed, since the answer depends on how
    // `setHours` resolves an ambiguous local time.
    const rows = hoursOf('2026-10-25', '2026-10-25')

    expect(rows).toEqual([...new Set(rows)])
    expect(rows).toHaveLength(24)
    expect(rows.filter((row) => row.endsWith('T02:00'))).toHaveLength(1)
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

const ROWS = hoursOf('2026-08-01', '2026-08-01')

const placed = (id: string, start: string, end: string) => ({
  id,
  title: id,
  time_slot_start: start,
  time_slot_end: end,
})

// 08:00Z is 10:00 local in August; the suite is pinned to Europe/Stockholm.
const at = (hourUtc: number) => `2026-08-01T${String(hourUtc).padStart(2, '0')}:00:00.000Z`

describe('how many rows a dream covers', () => {
  it('covers one row for an hour', () => {
    expect(rowSpanOf(ROWS, at(8), at(9))).toBe(1)
  })

  it('covers three rows for three hours — the 18-to-21 case', () => {
    expect(rowSpanOf(ROWS, at(8), at(11))).toBe(3)
  })

  it('still covers a row when it is shorter than one', () => {
    expect(rowSpanOf(ROWS, at(8), '2026-08-01T08:30:00.000Z')).toBe(1)
  })

  it('covers the row its end spills into', () => {
    expect(rowSpanOf(ROWS, at(8), '2026-08-01T10:30:00.000Z')).toBe(3)
  })

  it('is clamped to the grid rather than running off the end', () => {
    expect(rowSpanOf(ROWS, at(21), '2026-08-05T00:00:00.000Z')).toBe(1)
  })
})

describe('a lane as table cells', () => {
  const kinds = (cells: ReturnType<typeof laneCells>) => cells.map((cell) => cell.kind)

  it('anchors a three-hour dream and covers the two rows under it', () => {
    const cells = laneCells(ROWS, [placed('a', at(8), at(11))])
    const anchor = ROWS.indexOf('2026-08-01T10:00')

    expect(cells[anchor]).toMatchObject({ kind: 'anchor', span: 3 })
    expect(kinds(cells).slice(anchor, anchor + 4)).toEqual(['anchor', 'covered', 'covered', 'empty'])
  })

  it('leaves every other row empty', () => {
    const cells = laneCells(ROWS, [placed('a', at(8), at(9))])

    expect(kinds(cells).filter((kind) => kind === 'empty')).toHaveLength(ROWS.length - 1)
  })

  it('shares one cell between two dreams starting in the same hour', () => {
    const cells = laneCells(ROWS, [placed('a', at(8), at(9)), placed('b', at(8), at(9))])
    const anchor = cells[ROWS.indexOf('2026-08-01T10:00')]

    expect(anchor?.kind === 'anchor' && anchor.dreams.map((d) => d.id)).toEqual(['a', 'b'])
  })

  it('keeps a dream that starts inside another, rather than dropping it', () => {
    // An overlap in one lane is an organiser's mistake to see. The covered rows
    // render no cell of their own, so the only place left is the block above.
    const cells = laneCells(ROWS, [placed('long', at(8), at(11)), placed('inside', at(9), at(10))])
    const anchor = cells[ROWS.indexOf('2026-08-01T10:00')]

    expect(anchor?.kind === 'anchor' && anchor.dreams.map((d) => d.id)).toEqual(['long', 'inside'])
  })

  it('grows the block when the dream inside it runs past the end', () => {
    const cells = laneCells(ROWS, [placed('long', at(8), at(10)), placed('later', at(9), at(13))])
    const anchor = cells[ROWS.indexOf('2026-08-01T10:00')]

    // 10:00 through 15:00 exclusive is five rows, not four: the block has to
    // reach the end of the dream that joined it.
    expect(anchor).toMatchObject({ kind: 'anchor', span: 5 })
    expect(kinds(cells).slice(ROWS.indexOf('2026-08-01T10:00'), ROWS.indexOf('2026-08-01T16:00'))).toEqual([
      'anchor',
      'covered',
      'covered',
      'covered',
      'covered',
      'empty',
    ])
  })

  it('emits exactly one cell per row once covered rows are dropped', () => {
    // The invariant `rowSpan` depends on: anchors plus their spans must account
    // for every row, or the column shifts sideways.
    const cells = laneCells(ROWS, [placed('a', at(8), at(11)), placed('b', at(14), at(15))])
    const rendered = cells.reduce((total, cell) => total + (cell.kind === 'covered' ? 0 : 1), 0)
    const spanned = cells.reduce(
      (total, cell) => total + (cell.kind === 'anchor' ? cell.span : cell.kind === 'empty' ? 1 : 0),
      0,
    )

    expect(spanned).toBe(ROWS.length)
    expect(rendered).toBeLessThan(ROWS.length)
  })
})
