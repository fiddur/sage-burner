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
})
