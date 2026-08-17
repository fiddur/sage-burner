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
    onADesktop()
    const { result } = renderHook(() => usePhone())
    expect(result.current).toBe(false)

    await act(() => onAPhone())

    expect(result.current).toBe(true)
  })

  it('answers "not a phone" where the browser cannot say', () => {
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
  const at = (position: number, hidden = false): BarScroll => ({ hidden, from: position })

  const through = (start: BarScroll, ...positions: number[]) =>
    positions.reduce((state, position) => scrolledTo(state, position, false), start)

  it('shows it at the top of the page', () => {
    expect(scrolledTo(at(900, true), 0, false).hidden).toBe(false)
  })

  it('shows it at the top even when nothing has moved far enough to count', () => {
    expect(scrolledTo(at(40, true), 20, false).hidden).toBe(false)
  })

  it('hides it once a run down has gone far enough', () => {
    expect(through(at(100), 400).hidden).toBe(true)
  })

  it('leaves it alone for a nudge', () => {
    expect(through(at(100), 110).hidden).toBe(false)
  })

  it('brings it back on a run up', () => {
    expect(through(at(100), 400, 300).hidden).toBe(false)
  })

  it('counts a run rather than one event at a time', () => {
    const flick = Array.from({ length: 12 }, (_unused, step) => 200 + step * 4)

    expect(through(at(200), ...flick).hidden).toBe(true)
    expect(scrolledTo(at(200), 204, false).hidden).toBe(false)
  })

  it('does not flip on a bounce at the end of the page', () => {
    const hiddenAtTheEnd = through(at(100), 400)
    expect(hiddenAtTheEnd.hidden).toBe(true)

    const bounced = [1000, 940, 1000, 930].reduce(
      (state, position) => scrolledTo(state, position, true),
      hiddenAtTheEnd,
    )

    expect(bounced.hidden).toBe(true)
  })

  it('takes the bounce back once the page is being read again', () => {
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
