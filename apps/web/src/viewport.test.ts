import { act, renderHook } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'

import type { BarScroll } from './viewport.ts'

import { onADesktop, onAPhone } from './testing/viewport.ts'
import { AT_REST, nearTheEnd, scrolledTo, usePhone } from './viewport.ts'

afterEach(onADesktop)

describe('usePhone', () => {
  it('says no on a wide viewport', () => {
    onADesktop()

    expect(renderHook(() => usePhone()).result.current).toBe(false)
  })

  it('says yes on a narrow one', () => {
    onAPhone()

    expect(renderHook(() => usePhone()).result.current).toBe(true)
  })

  it('changes its mind when the window does', async () => {
    // A rotation, and the case the listener exists for: without it the app keeps the
    // layout it was opened in until something else re-renders it.
    onADesktop()
    const { result } = renderHook(() => usePhone())
    expect(result.current).toBe(false)

    // Inside `act`: the listener sets state from outside a render, so without it the
    // rerender is still queued when the assertion runs.
    await act(() => onAPhone())

    expect(result.current).toBe(true)
  })

  it('answers "not a phone" where the browser cannot say', () => {
    // The layout everything worked in before, which is the safe half to fall back to:
    // a bottom bar nobody asked for is worse than a header that has to wrap.
    const held = globalThis.matchMedia
    Reflect.deleteProperty(globalThis, 'matchMedia')

    try {
      expect(renderHook(() => usePhone()).result.current).toBe(false)
    } finally {
      globalThis.matchMedia = held
    }
  })
})

describe('where the bottom bar should be', () => {
  /** Settled part-way down a page, which is where every run below begins. */
  const at = (position: number, hidden = false): BarScroll => ({ hidden, from: position })

  /** Scrolls through a series of positions, none of them near either end. */
  const through = (start: BarScroll, ...positions: number[]) =>
    positions.reduce((state, position) => scrolledTo(state, position, false), start)

  it('shows it at the top of the page', () => {
    expect(scrolledTo(at(900, true), 0, false).hidden).toBe(false)
  })

  it('shows it at the top even when nothing has moved far enough to count', () => {
    // The branch the line above cannot reach: a run up from 900 to 0 crosses the
    // threshold on its own. iOS bouncing at the top moves twenty pixels at a time,
    // so without a floor the bar would stay hidden while the page is at its start.
    expect(scrolledTo(at(40, true), 20, false).hidden).toBe(false)
  })

  it('hides it once a run down has gone far enough', () => {
    expect(through(at(100), 400).hidden).toBe(true)
  })

  it('leaves it alone for a nudge', () => {
    // The threshold, from the other side: a page that twitches under a thumb is not
    // being read away from.
    expect(through(at(100), 110).hidden).toBe(false)
  })

  it('brings it back on a run up', () => {
    expect(through(at(100), 400, 300).hidden).toBe(false)
  })

  it('counts a run rather than one event at a time', () => {
    // What the accumulation is for: a flick arrives as a burst of small deltas, and a
    // per-event threshold would be crossed by none of them — the bar would sit still
    // through the whole gesture.
    const flick = Array.from({ length: 12 }, (_unused, step) => 200 + step * 4)

    expect(through(at(200), ...flick).hidden).toBe(true)
    // Measured, not assumed: no single step is past the threshold.
    expect(scrolledTo(at(200), 204, false).hidden).toBe(false)
  })

  it('does not flip on a bounce at the end of the page', () => {
    // iOS rubber-banding reports movement in both directions while the finger is
    // still, which reads as "scrolled up" and pops the bar back mid-gesture.
    const hiddenAtTheEnd = through(at(100), 400)
    expect(hiddenAtTheEnd.hidden).toBe(true)

    const bounced = [1000, 940, 1000, 930].reduce(
      (state, position) => scrolledTo(state, position, true),
      hiddenAtTheEnd,
    )

    expect(bounced.hidden).toBe(true)
  })

  it('takes the bounce back once the page is being read again', () => {
    // The passing sibling: freezing near the end must not outlive being near the end,
    // or the bar would never come back on a long page.
    const stuck = [1000, 940].reduce(
      (state, position) => scrolledTo(state, position, true),
      through(at(100), 400),
    )

    expect(scrolledTo(stuck, 800, false).hidden).toBe(false)
  })

  it('keeps hiding it on a scroll that goes on down', () => {
    expect(through(at(100), 400, 800).hidden).toBe(true)
  })

  it('starts shown, at the top', () => {
    expect(AT_REST.hidden).toBe(false)
  })
})

describe('near the end of the page', () => {
  // 2000 of page, 800 of window: the last screen starts at 1200, and `REST` of
  // slack either side of it is where the bounce lives.
  it('is not the middle of a long page', () => {
    expect(nearTheEnd(400, 800, 2000)).toBe(false)
  })

  it('is the last screenful', () => {
    expect(nearTheEnd(1200, 800, 2000)).toBe(true)
  })

  it('is a little before it, since the bounce starts before the edge', () => {
    expect(nearTheEnd(1160, 800, 2000)).toBe(true)
    expect(nearTheEnd(1140, 800, 2000)).toBe(false)
  })

  it('is the whole of a page that does not scroll', () => {
    expect(nearTheEnd(0, 800, 600)).toBe(true)
  })
})
