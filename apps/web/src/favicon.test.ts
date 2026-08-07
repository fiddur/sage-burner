import { notificationBadge, apiRoutes } from '@sage-burner/shared'
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
  it('draws the icon first and the dot on top of it', () => {
    // The order is the point: a dot under the icon is a dot nobody sees.
    const { canvas, calls, recorder } = fakeCanvas()

    expect(composeBadged(anImage, canvas)).toBe('data:image/png;base64,drawn')
    expect(calls).toEqual(['image 0,0 64x64', 'begin', 'arc 50,16 r13', 'fill', 'stroke'])
    expect(recorder.fillStyle).toBe(notificationBadge.fill)
    expect(recorder.strokeStyle).toBe(notificationBadge.stroke)
  })

  it('sizes the canvas before it draws, or the drawing is wiped', () => {
    // Assigning `width` resets a canvas — the fake above does too. Sizing it after
    // `drawImage` throws the icon away and leaves the dot alone on a transparent
    // square, so what pins the ordering is that the icon is still in `calls`.
    const { canvas, calls } = fakeCanvas()

    composeBadged(anImage, canvas)

    expect(canvas.width).toBe(64)
    expect(canvas.height).toBe(64)
    expect(calls).toContain('image 0,0 64x64')
  })

  it('answers with nothing when the browser gives no 2D context', () => {
    // Nothing rather than a broken data URL: the caller keeps the plain icon it set
    // first, which is the whole failure story.
    const { canvas } = fakeCanvas(null)

    expect(composeBadged(anImage, canvas)).toBeUndefined()
  })
})

describe('the tab’s icon link', () => {
  const ICON = apiRoutes.getInstallationIcon.path()

  /** An image that never loads, which is what happy-dom does with a real one. */
  const neverLoads = () => new Promise<HTMLImageElement | undefined>(() => undefined)

  const link = () => document.head.querySelector<HTMLLinkElement>('link#app-favicon')

  it('points at the installation’s own icon, not at a mark of its own', () => {
    // Whatever the admin uploaded, or the app's flame when nothing is — the route
    // answers either way, so there is no unset case here to branch on.
    markFavicon(false, { load: neverLoads })

    expect(link()?.getAttribute('href')).toBe(ICON)
  })

  it('shows that icon straight away even while something is waiting', () => {
    // Synchronous and first: composing needs a fetch, and the tab must not sit blank
    // — nor wear the wrong mark — while that happens.
    markFavicon(true, { load: neverLoads })

    expect(link()?.getAttribute('href')).toBe(ICON)
  })

  it('draws the dot onto it once the icon has loaded', async () => {
    // The half that had no test at all: happy-dom fires neither `load` nor `error`
    // on a real image, so injecting the loader is what makes this reachable.
    markFavicon(true, {
      load: () => Promise.resolve({} as HTMLImageElement),
      canvas: () => fakeCanvas().canvas,
    })

    await Promise.resolve()
    await Promise.resolve()

    expect(link()?.getAttribute('href')).not.toBe(ICON)
  })

  it('keeps the plain icon when the icon will not load', async () => {
    markFavicon(true, { load: () => Promise.resolve(undefined) })

    await Promise.resolve()
    await Promise.resolve()

    expect(link()?.getAttribute('href')).toBe(ICON)
  })

  it('does not let a slow drawing land after the cleanup that cancelled it', async () => {
    // The one piece with a described failure mode: without the guard, a dot arrives
    // on a tab that has nothing waiting any more.
    let settle: (image: HTMLImageElement | undefined) => void = () => undefined
    const restore = markFavicon(true, {
      load: () => new Promise((resolve) => (settle = resolve)),
      canvas: () => fakeCanvas().canvas,
    })

    restore()
    settle({} as HTMLImageElement)
    await Promise.resolve()
    await Promise.resolve()

    expect(link()?.getAttribute('href')).toBe(ICON)
  })

  it('takes the dot back off in the cleanup', async () => {
    const restore = markFavicon(true, {
      load: () => Promise.resolve({} as HTMLImageElement),
      canvas: () => fakeCanvas().canvas,
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(link()?.getAttribute('href')).not.toBe(ICON)

    restore()

    expect(link()?.getAttribute('href')).toBe(ICON)
  })

  it('reuses the one link rather than stacking a new one per change', () => {
    // Two `rel="icon"` links leave it to the browser which wins, which is how the
    // first attempt at #285 came out inert.
    markFavicon(false, { load: neverLoads })
    markFavicon(true, { load: neverLoads })
    markFavicon(false, { load: neverLoads })

    expect(document.head.querySelectorAll('link[rel="icon"]')).toHaveLength(1)
  })

  it('does nothing at all where there is no document', () => {
    const head = vi.spyOn(globalThis, 'document', 'get').mockReturnValue(undefined as never)

    expect(() => markFavicon(true)()).not.toThrow()

    head.mockRestore()
  })
})
