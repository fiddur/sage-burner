import { describe, expect, it } from 'vitest'

import { pinchedZoom, touchGap, ZOOM_MAX, ZOOM_MIN } from './pinch.ts'

const at = (clientX: number, clientY: number) => ({ clientX, clientY })

describe('measuring a pinch', () => {
  it('measures both directions at once, not one of them', () => {
    expect(touchGap(at(0, 0), at(3, 4))).toBe(5)
  })

  it('does not care which finger is named first', () => {
    expect(touchGap(at(10, 10), at(40, 50))).toBe(touchGap(at(40, 50), at(10, 10)))
  })
})

describe('the zoom a pinch reaches', () => {
  it('scales the grid by how much wider the fingers got', () => {
    expect(pinchedZoom({ gap: 100, zoom: 1 }, 200)).toBe(2)
    expect(pinchedZoom({ gap: 100, zoom: 1 }, 50)).toBe(0.5)
  })

  it('carries on from where the last pinch left it', () => {
    expect(pinchedZoom({ gap: 100, zoom: 2 }, 110)).toBeCloseTo(2.2)
  })

  it('is measured from the start of the pinch, so it can be taken back', () => {
    const start = { gap: 120, zoom: 1.5 }

    expect(pinchedZoom(start, 200)).not.toBe(1.5)
    expect(pinchedZoom(start, 120)).toBe(1.5)
  })

  it('stops rather than running away in either direction', () => {
    expect(pinchedZoom({ gap: 10, zoom: 1 }, 10000)).toBe(ZOOM_MAX)
    expect(pinchedZoom({ gap: 10000, zoom: 1 }, 1)).toBe(ZOOM_MIN)
  })

  it('keeps still when two fingers land on one pixel', () => {
    expect(pinchedZoom({ gap: 0, zoom: 1.3 }, 80)).toBe(1.3)
  })
})
