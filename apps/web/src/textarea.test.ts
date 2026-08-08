import { describe, expect, it } from 'vitest'

import { MAX_ROWS, MIN_ROWS, rowsFor } from './textarea.ts'

describe('how tall a text box opens', () => {
  it('gives an empty box the floor', () => {
    expect(rowsFor('')).toBe(MIN_ROWS)
  })

  it('does not shrink below the floor for a line or two', () => {
    expect(rowsFor('One line')).toBe(MIN_ROWS)
    expect(rowsFor('One\ntwo')).toBe(MIN_ROWS)
  })

  it('opens as tall as the text it holds', () => {
    // The bug, at the boundary it is about: twenty lines used to open at three.
    const twenty = Array.from({ length: 20 }, (_unused, line) => `line ${line}`).join('\n')

    expect(rowsFor(twenty)).toBe(20)
    expect(rowsFor(twenty)).toBeGreaterThan(rowsFor('one line'))
  })

  it('counts the line a trailing newline leaves', () => {
    // Where the cursor actually is after pressing return at the end.
    expect(rowsFor(`${'x\n'.repeat(9)}`)).toBe(10)
  })

  it('counts a long paragraph as the lines it wraps to', () => {
    // One logical line, several visual ones. Counting `\n` alone opened a page of
    // unbroken prose at the floor, which is the same complaint in a different shape.
    const paragraph = 'x'.repeat(500)

    expect(rowsFor(paragraph)).toBeGreaterThan(MIN_ROWS)
    expect(rowsFor(paragraph)).toBeLessThan(MAX_ROWS)
  })

  it('stops at a ceiling, so Save stays on the screen', () => {
    expect(rowsFor('line\n'.repeat(200))).toBe(MAX_ROWS)
  })

  it("takes a caller's floor over its own", () => {
    expect(rowsFor('', 12)).toBe(12)
    expect(rowsFor('one line', 12)).toBe(12)
  })

  it("still grows past a caller's floor", () => {
    expect(rowsFor('line\n'.repeat(19), 12)).toBe(20)
  })

  it('does not clamp a floor above its own ceiling', () => {
    expect(rowsFor('', MAX_ROWS + 16)).toBe(MAX_ROWS + 16)
  })
})
