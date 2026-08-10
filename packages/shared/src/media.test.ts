import { describe, expect, it } from 'vitest'

import { FLAME_BOX, FLAME_SHAPES, flameIcon, flamePath } from './media.ts'

describe('the app’s own mark', () => {
  it('draws the shapes, and only the shapes', () => {
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
