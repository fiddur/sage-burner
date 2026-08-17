import { BANNER_HEIGHT, BANNER_WIDTH } from '@sage-burner/shared'
import { describe, expect, it } from 'vitest'

import { coverCrop } from './banner.ts'

const ratio = (crop: { width: number; height: number }) => crop.width / crop.height

describe('cropping a picture to the card', () => {
  it('takes the full width of a picture that is too tall, from the middle', () => {
    const crop = coverCrop(1000, 1000)

    expect(crop.width).toBe(1000)
    expect(crop.height).toBeCloseTo(525)
    expect(crop.x).toBe(0)
    expect(crop.y).toBeCloseTo(237.5)
  })

  it('takes the full height of a picture that is too wide, from the middle', () => {
    const crop = coverCrop(4000, 1000)

    expect(crop.height).toBe(1000)
    expect(crop.width).toBeCloseTo(1904.76, 1)
    expect(crop.y).toBe(0)
    expect(crop.x).toBeCloseTo(1047.62, 1)
  })

  it('leaves a picture already at the card’s shape alone', () => {
    const crop = coverCrop(BANNER_WIDTH, BANNER_HEIGHT)

    expect(crop).toEqual({ x: 0, y: 0, width: BANNER_WIDTH, height: BANNER_HEIGHT })
  })

  it('comes out at the card’s shape whatever it was given', () => {
    for (const [width, height] of [
      [800, 600],
      [600, 800],
      [3000, 200],
      [100, 3000],
    ] as const) {
      expect(ratio(coverCrop(width, height))).toBeCloseTo(BANNER_WIDTH / BANNER_HEIGHT, 5)
    }
  })

  it('never asks for pixels the picture does not have', () => {
    for (const [width, height] of [
      [800, 600],
      [600, 800],
      [1200, 630],
    ] as const) {
      const crop = coverCrop(width, height)

      expect(crop.x).toBeGreaterThanOrEqual(0)
      expect(crop.y).toBeGreaterThanOrEqual(0)
      expect(crop.x + crop.width).toBeLessThanOrEqual(width + 0.001)
      expect(crop.y + crop.height).toBeLessThanOrEqual(height + 0.001)
    }
  })
})
