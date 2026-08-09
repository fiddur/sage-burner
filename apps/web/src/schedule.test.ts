import { describe, expect, it } from 'vitest'

import {
  hourOf,
  hoursOf,
  laneCells,
  mealBlocks,
  mealMovedTo,
  resizedEnd,
  rowsDragged,
  rowSpanOf,
} from './schedule.ts'

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

  it('is 49 rows for midday Friday to midday Sunday, the figure docs/schedule.md quotes', () => {
    // A number in prose goes stale silently, so it is asserted here.
    expect(hoursOf('2026-08-01', '2026-08-03', '12:00', '12:00')).toHaveLength(49)
  })

  it('starts at the hour the burn opens, not at midnight', () => {
    const rows = hoursOf('2026-08-01', '2026-08-01', '15:30', '22:00')

    expect(rows[0]).toBe('2026-08-01T15:00')
    expect(rows.at(-1)).toBe('2026-08-01T22:00')
  })

  it('runs past midnight when the burn does, without an extra day of empties', () => {
    // What `dayAfter` used to guess at. The admin says 04:00 on the 3rd and
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
    // An overlap in one lane is an admin's mistake to see. The covered rows
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

describe('pulling a dream’s bottom edge', () => {
  const twoHours = {
    time_slot_start: '2026-08-01T18:00:00.000Z',
    time_slot_end: '2026-08-01T20:00:00.000Z',
  }

  it('makes it longer by whole hours', () => {
    expect(resizedEnd(twoHours, 1)).toBe('2026-08-01T21:00:00.000Z')
    expect(resizedEnd(twoHours, 3)).toBe('2026-08-01T23:00:00.000Z')
  })

  it('makes it shorter, down to the hour a row is worth', () => {
    expect(resizedEnd(twoHours, -1)).toBe('2026-08-01T19:00:00.000Z')
    // Not zero, and not backwards: a dream still has to occupy the row it starts in.
    expect(resizedEnd(twoHours, -5)).toBe('2026-08-01T19:00:00.000Z')
  })

  it('answers null when nothing would change', () => {
    // The caller sends no PATCH for these. A drag that never crossed a boundary is
    // the common one — a few pixels of hand tremor is not a resize.
    expect(resizedEnd(twoHours, 0)).toBeNull()
    expect(
      resizedEnd(
        { time_slot_start: twoHours.time_slot_start, time_slot_end: '2026-08-01T19:00:00.000Z' },
        -1,
      ),
    ).toBeNull()
  })

  it('leaves an unscheduled dream alone, since it has no edge to pull', () => {
    expect(resizedEnd({ time_slot_start: null, time_slot_end: null }, 1)).toBeNull()
    expect(resizedEnd({ time_slot_start: twoHours.time_slot_start, time_slot_end: null }, 1)).toBeNull()
  })

  it('snaps an odd length onto the hour it is nearest', () => {
    // The grid cannot show 20:40, so a resize done in it must not set one. The
    // Dreams form is where a minute-precision end is typed.
    const ninety = {
      time_slot_start: '2026-08-01T18:00:00.000Z',
      time_slot_end: '2026-08-01T19:30:00.000Z',
    }

    expect(resizedEnd(ninety, 1)).toBe('2026-08-01T21:00:00.000Z')
  })
})

describe('how far a pointer dragged, in rows', () => {
  it('rounds to the nearest whole row', () => {
    expect(rowsDragged(0, 40)).toBe(0)
    expect(rowsDragged(19, 40)).toBe(0)
    expect(rowsDragged(21, 40)).toBe(1)
    expect(rowsDragged(-85, 40)).toBe(-2)
  })

  it('says nothing moved when the row has no height to divide by', () => {
    // Which is every row under happy-dom: it computes no layout, so the pointer
    // half of this gesture wants a click-through in a browser. Guarded rather than
    // left to produce Infinity and a resize to the end of time.
    expect(rowsDragged(120, 0)).toBe(0)
  })
})

describe('the blocks a meal draws', () => {
  const dinner = { id: 'm-1', date: '2026-08-01', at: '18:00', label: 'Dinner', kind: 'meal' as const }

  it('cooks for two hours, eats for one and washes up for one', () => {
    // Pinned to Europe/Stockholm: 18:00 local in August is 16:00Z.
    expect(mealBlocks(dinner)).toEqual([
      {
        id: 'm-1:cook',
        meal_id: 'm-1',
        part: 'cook',
        title: 'Cooking · Dinner',
        time_slot_start: '2026-08-01T14:00:00.000Z',
        time_slot_end: '2026-08-01T16:00:00.000Z',
      },
      {
        id: 'm-1:serve',
        meal_id: 'm-1',
        part: 'serve',
        title: 'Dinner',
        time_slot_start: '2026-08-01T16:00:00.000Z',
        time_slot_end: '2026-08-01T17:00:00.000Z',
      },
      {
        id: 'm-1:clean',
        meal_id: 'm-1',
        part: 'clean',
        title: 'Cleanup · Dinner',
        time_slot_start: '2026-08-01T17:00:00.000Z',
        time_slot_end: '2026-08-01T18:00:00.000Z',
      },
    ])
  })

  it('draws a chore as one hour of itself, since cooking for a cleanup is nonsense', () => {
    const blocks = mealBlocks({ ...dinner, label: 'Morning cleanup', at: '09:00', kind: 'chore' })

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ part: 'serve', title: 'Morning cleanup' })
  })

  it('draws nothing for a meal whose time makes no sense', () => {
    expect(mealBlocks({ ...dinner, at: 'noon' })).toEqual([])
  })
})

describe('dropping one of a meal’s blocks', () => {
  it('puts the block where it landed, and the meal follows', () => {
    // Cooking is the two hours before, so dropping it on 12:00 is a 14:00 meal.
    expect(mealMovedTo('cook', '2026-08-02T12:00')).toEqual({ date: '2026-08-02', at: '14:00' })
    expect(mealMovedTo('serve', '2026-08-02T14:00')).toEqual({ date: '2026-08-02', at: '14:00' })
    expect(mealMovedTo('clean', '2026-08-02T15:00')).toEqual({ date: '2026-08-02', at: '14:00' })
  })

  it('carries the meal onto another day when the offset crosses midnight', () => {
    // Dropping the cleanup block on 00:00 means a meal at 23:00 the night before.
    expect(mealMovedTo('clean', '2026-08-03T00:00')).toEqual({ date: '2026-08-02', at: '23:00' })
  })

  it('answers nothing for a row that is not a time', () => {
    expect(mealMovedTo('serve', 'whenever')).toBeUndefined()
  })
})
