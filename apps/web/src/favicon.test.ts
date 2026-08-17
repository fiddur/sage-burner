import { apiRoutes } from '@sage-burner/shared'
import { describe, expect, it, vi } from 'vitest'

import type { BadgeCanvas } from './favicon.ts'

import { badgeSpot, composeBadged, markFavicon } from './favicon.ts'

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
    expect(badgeSpot(64)).toEqual({ x: 50, y: 16, radius: 13, stroke: 3 })
  })

  it('scales with the canvas rather than staying put', () => {
    expect(badgeSpot(128)).toEqual({ x: 100, y: 32, radius: 26, stroke: 6 })
    expect(badgeSpot(32)).toEqual({ x: 25, y: 8, radius: 6.5, stroke: 1.5 })
  })
})

describe('composing the tab icon', () => {
  it('draws the icon first and the dot on top of it', () => {
    const { canvas, calls, recorder } = fakeCanvas()

    expect(composeBadged(anImage, canvas)).toBe('data:image/png;base64,drawn')
    expect(calls).toEqual(['image 0,0 64x64', 'begin', 'arc 50,16 r13', 'fill', 'stroke'])
    expect(recorder.fillStyle).toBe('#dc2626')
    expect(recorder.strokeStyle).toBe('#fff')
  })

  it('sizes the canvas before it draws, or the drawing is wiped', () => {
    const { canvas, calls } = fakeCanvas()

    composeBadged(anImage, canvas)

    expect(canvas.width).toBe(64)
    expect(canvas.height).toBe(64)
    expect(calls).toContain('image 0,0 64x64')
  })

  it('answers with nothing when the browser gives no 2D context', () => {
    const { canvas } = fakeCanvas(null)

    expect(composeBadged(anImage, canvas)).toBeUndefined()
  })
})

describe('the tab’s icon link', () => {
  const ICON = apiRoutes.getInstallationIcon.path()

  const neverLoads = () => new Promise<HTMLImageElement | undefined>(() => undefined)

  const link = () => document.head.querySelector<HTMLLinkElement>('link#app-favicon')

  it('points at the installation’s own icon, not at a mark of its own', () => {
    markFavicon(false, { load: neverLoads })

    expect(link()?.getAttribute('href')).toBe(ICON)
  })

  it('shows that icon straight away even while something is waiting', () => {
    markFavicon(true, { load: neverLoads })

    expect(link()?.getAttribute('href')).toBe(ICON)
  })

  it('draws the dot onto it once the icon has loaded', async () => {
    markFavicon(true, {
      load: () => Promise.resolve({} as HTMLImageElement),
      canvas: () => fakeCanvas().canvas,
    })

    await Promise.resolve()
    await Promise.resolve()

    expect(link()?.getAttribute('href')).toBe('data:image/png;base64,drawn')
  })

  it('keeps the plain icon when the icon will not load', async () => {
    markFavicon(true, { load: () => Promise.resolve(undefined) })

    await Promise.resolve()
    await Promise.resolve()

    expect(link()?.getAttribute('href')).toBe(ICON)
  })

  it('does not let a slow drawing land after the cleanup that cancelled it', async () => {
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
    expect(link()?.getAttribute('href')).toBe('data:image/png;base64,drawn')

    restore()

    expect(link()?.getAttribute('href')).toBe(ICON)
  })

  it('reuses the one link rather than stacking a new one per change', () => {
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
