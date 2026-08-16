import { describe, expect, it } from 'vitest'

import { flipsUp } from './dropdown.ts'

describe('which way a dropdown opens', () => {
  it('hangs below wherever it fits, which is the ordinary case', () => {
    expect(flipsUp(93, 150, 200)).toBe(false)
  })

  it('flips above where below would put it outside the scroller', () => {
    // The measurements from #699: a 179px bell panel, the last row's 93px menu with 33px
    // under it and 140px over.
    expect(flipsUp(93, 140, 33)).toBe(true)
  })

  it('stays below for a row near the top, where flipping only moves the problem', () => {
    expect(flipsUp(93, 10, 60)).toBe(false)
  })

  it('stays below where it fits exactly, an equal fit being no reason to move', () => {
    expect(flipsUp(93, 400, 93)).toBe(false)
  })

  it('stays below when neither side holds it, the overflow below being the reachable one', () => {
    // One notification in the bell (#708): a 66px panel, 11px above the row's menu button and
    // 33px under it, for a 93px menu. Flipping would put 82px past the panel's top, which no
    // scrolling reaches; below it is 60px past the bottom, which scrolling does.
    expect(flipsUp(93, 11, 33)).toBe(false)
  })

  it('stays below where above is roomier but still too small', () => {
    // Two notifications: 68px above against 33px below. The old rule flipped on that
    // comparison alone and clipped the first entry off the top of the panel.
    expect(flipsUp(93, 68, 33)).toBe(false)
  })
})
