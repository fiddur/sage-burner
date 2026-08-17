import { describe, expect, it } from 'vitest'

import { FLAME_BOX, FLAME_SHAPES, flameIcon, flamePath } from './media.ts'

describe('the app’s own mark', () => {
  it('draws each shape as the curve it is, rather than as the expression that built it', () => {
    expect(FLAME_SHAPES.map((shape) => flamePath(shape))).toEqual([
      'M33 2C37 14 49 20 49 35C49 49 41 60 32 60C23 60 15 49 15 36C15 24 28 20 33 2Z',
      'M32 25C35 31 41 36 41 44C41 51 37 55 32 55C27 55 23 51 23 44C23 36 29 31 32 25Z',
    ])
  })

  it('wraps them in one svg of its own box, and nothing else', () => {
    expect(flameIcon()).toBe(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FLAME_BOX} ${FLAME_BOX}">` +
        FLAME_SHAPES.map((shape) => `<path d="${flamePath(shape)}" fill="${shape.fill}"/>`).join('') +
        `</svg>`,
    )
  })

  it('is geometry rather than a glyph, so a tile can be drawn from it', () => {
    expect(flameIcon()).not.toContain('<text')
    expect(flameIcon()).not.toContain('font-size')
    expect(FLAME_SHAPES.length).toBeGreaterThan(0)
  })

  it('closes every path, since an open one fills to wherever it started', () => {
    for (const shape of FLAME_SHAPES) {
      expect(flamePath(shape).endsWith('Z'), shape.fill).toBe(true)
      expect(flamePath(shape).startsWith('M'), shape.fill).toBe(true)
    }
  })

  it('ends each path where it began, so the fill has no seam', () => {
    for (const shape of FLAME_SHAPES) {
      expect(shape.curves.at(-1)?.to, shape.fill).toEqual(shape.from)
    }
  })

  it('stays inside its own box', () => {
    const coordinates = FLAME_SHAPES.flatMap((shape) => [
      shape.from,
      ...shape.curves.flatMap((curve) => [curve.c1, curve.c2, curve.to]),
    ])

    for (const [x, y] of coordinates) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(FLAME_BOX)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(FLAME_BOX)
    }
  })
})
