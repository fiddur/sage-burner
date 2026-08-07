import { notificationBadge } from '@sage-burner/shared'
import { describe, expect, it, vi } from 'vitest'

import type { BadgeCanvas } from './favicon.ts'

import { badgeSpot, composeBadged, markFavicon } from './favicon.ts'

/** A canvas that records what was asked of it rather than drawing anything. */
const fakeCanvas = (context: Partial<CanvasRenderingContext2D> | null = {}) => {
  const calls: string[] = []
  const recorder = {
    clearRect: () => calls.push('clear'),
    drawImage: (_image: unknown, x: number, y: number, w: number, h: number) =>
      calls.push(`image ${x},${y} ${w}x${h}`),
    beginPath: () => calls.push('begin'),
    arc: (x: number, y: number, r: number) => calls.push(`arc ${x},${y} r${r}`),
    fill: () => calls.push('fill'),
    stroke: () => calls.push('stroke'),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    ...context,
  }

  // Assigning `width` throws away everything drawn, which is what a real canvas
  // does — and the only reason the sizing has to come first. A plain property here
  // would let a test claim to pin that ordering while passing either way.
  let width = 0
  let height = 0

  const canvas: BadgeCanvas = {
    get width() {
      return width
    },
    set width(next: number) {
      width = next
      calls.length = 0
    },
    get height() {
      return height
    },
    set height(next: number) {
      height = next
      calls.length = 0
    },
    getContext: () => (context === null ? null : (recorder as unknown as CanvasRenderingContext2D)),
    toDataURL: () => 'data:image/png;base64,drawn',
  }

  return { canvas, calls, recorder }
}

const anImage = {} as CanvasImageSource

describe('where the dot goes on a canvas', () => {
  it('lands where the SVG puts it, at the mark’s own size', () => {
    // 64 is `notificationBadge.box`, so at that size the numbers pass through
    // untouched and must equal the ones `flameIcon` writes into its `<circle>`.
    expect(badgeSpot(64)).toEqual({ x: 50, y: 16, radius: 13, stroke: 3 })
  })

  it('scales with the canvas rather than staying put', () => {
    // A favicon drawn at 128 with a dot placed for 64 would sit at the middle of the
    // image instead of its corner.
    expect(badgeSpot(128)).toEqual({ x: 100, y: 32, radius: 26, stroke: 6 })
    expect(badgeSpot(32)).toEqual({ x: 25, y: 8, radius: 6.5, stroke: 1.5 })
  })
})

describe('composing the tab icon', () => {
  it('draws the icon at the full size, and no dot when nothing is waiting', () => {
    const { canvas, calls } = fakeCanvas()

    expect(composeBadged(anImage, false, canvas)).toBe('data:image/png;base64,drawn')
    expect(calls).toEqual(['image 0,0 64x64'])
  })

  it('draws the dot over it when something is', () => {
    const { canvas, calls, recorder } = fakeCanvas()

    composeBadged(anImage, true, canvas)

    expect(calls).toEqual(['image 0,0 64x64', 'begin', 'arc 50,16 r13', 'fill', 'stroke'])
    expect(recorder.fillStyle).toBe(notificationBadge.fill)
    expect(recorder.strokeStyle).toBe(notificationBadge.stroke)
  })

  it('sizes the canvas before it draws, or the drawing is wiped', () => {
    // Assigning `width` resets a canvas — the fake above does too. Sizing it after
    // `drawImage` throws the icon away and leaves the dot alone on a transparent
    // square, so what pins the ordering is that the icon is still in `calls`.
    const { canvas, calls } = fakeCanvas()

    composeBadged(anImage, true, canvas)

    expect(canvas.width).toBe(64)
    expect(canvas.height).toBe(64)
    expect(calls).toContain('image 0,0 64x64')
  })

  it('answers with nothing when the browser gives no 2D context', () => {
    // Nothing rather than a broken data URL: the caller keeps the flame it set first,
    // which is the whole failure story.
    const { canvas } = fakeCanvas(null)

    expect(composeBadged(anImage, true, canvas)).toBeUndefined()
  })
})

describe('the tab’s icon link', () => {
  it('wears the flame straight away, before anything is fetched', () => {
    // Synchronous and first, so the tab never flickers through a blank icon while
    // the composed one loads — and so a failed load leaves the mark it had.
    markFavicon(false)

    const link = document.head.querySelector<HTMLLinkElement>('link#app-favicon')

    expect(link).not.toBeNull()
    expect(decodeURIComponent(link?.href ?? '')).toContain('🔥')
    expect(decodeURIComponent(link?.href ?? '')).not.toContain('<circle')
  })

  it('puts the dot in it while something is waiting', () => {
    markFavicon(true)

    const link = document.head.querySelector<HTMLLinkElement>('link#app-favicon')

    expect(decodeURIComponent(link?.href ?? '')).toContain('<circle')
  })

  it('takes the dot back off in the cleanup', () => {
    const restore = markFavicon(true)

    restore()

    const link = document.head.querySelector<HTMLLinkElement>('link#app-favicon')

    expect(decodeURIComponent(link?.href ?? '')).not.toContain('<circle')
  })

  it('reuses the one link rather than stacking a new one per change', () => {
    // Two `rel="icon"` links leave it to the browser which wins, which is how the
    // first attempt at #285 came out inert.
    markFavicon(false)
    markFavicon(true)
    markFavicon(false)

    expect(document.head.querySelectorAll('link[rel="icon"]')).toHaveLength(1)
  })

  it('does nothing at all where there is no document', () => {
    const head = vi.spyOn(globalThis, 'document', 'get').mockReturnValue(undefined as never)

    expect(() => markFavicon(true)()).not.toThrow()

    head.mockRestore()
  })
})
