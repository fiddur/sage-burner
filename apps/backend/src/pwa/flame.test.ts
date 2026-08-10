import { FLAME_SHAPES } from '@sage-burner/shared'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

import { coverageOf, createFlameIcons, drawFlame, encodePng } from './flame.ts'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const headerOf = (png: Buffer) => ({
  width: png.readUInt32BE(16),
  height: png.readUInt32BE(20),
  depth: png.readUInt8(24),
  colourType: png.readUInt8(25),
})

const chunksIn = (png: Buffer): string[] => {
  const found: string[] = []
  let at = SIGNATURE.length

  while (at < png.length) {
    const length = png.readUInt32BE(at)
    found.push(png.toString('ascii', at + 4, at + 8))
    at += length + 12
  }

  return found
}

const pixelsOf = (png: Buffer, size: number): Buffer => {
  let at = SIGNATURE.length
  const parts: Buffer[] = []

  while (at < png.length) {
    const length = png.readUInt32BE(at)
    if (png.toString('ascii', at + 4, at + 8) === 'IDAT') {
      parts.push(png.subarray(at + 8, at + 8 + length))
    }
    at += length + 12
  }

  const rows = inflateSync(Buffer.concat(parts))
  const pixels = Buffer.alloc(size * size * 3)
  for (let row = 0; row < size; row += 1) {
    rows.copy(pixels, row * size * 3, row * (size * 3 + 1) + 1, (row + 1) * (size * 3 + 1))
  }

  return pixels
}

const colourAt = (pixels: Buffer, size: number, x: number, y: number): [number, number, number] => [
  pixels[(y * size + x) * 3] ?? 0,
  pixels[(y * size + x) * 3 + 1] ?? 0,
  pixels[(y * size + x) * 3 + 2] ?? 0,
]

describe('filling the flame', () => {
  it('covers the middle of the shape and none of the corners', () => {
    const size = 64
    const outer = FLAME_SHAPES[0]
    if (outer === undefined) throw new Error('the flame has no shape')

    const cover = coverageOf(outer, size)

    expect(cover[Math.round(size * 0.5) * size + Math.round(size * 0.5)]).toBeCloseTo(1, 2)
    expect(cover[0]).toBe(0)
    expect(cover[size * size - 1]).toBe(0)
  })

  it('leaves a margin, so a circular mask cannot crop the tip off', () => {
    const size = 100
    const outer = FLAME_SHAPES[0]
    if (outer === undefined) throw new Error('the flame has no shape')

    const cover = coverageOf(outer, size)
    const rowsTouched = Array.from({ length: size }, (_unused, row) =>
      Array.from({ length: size }, (_also, column) => cover[row * size + column] ?? 0).some(
        (value) => value > 0,
      ),
    )

    expect(rowsTouched.slice(0, 8).some(Boolean)).toBe(false)
    expect(rowsTouched.slice(-8).some(Boolean)).toBe(false)
  })

  it('scales with the size asked for rather than drawing one and stretching it', () => {
    const small = coverageOf(FLAME_SHAPES[0] ?? { fill: '', from: [0, 0], curves: [] }, 32)
    const large = coverageOf(FLAME_SHAPES[0] ?? { fill: '', from: [0, 0], curves: [] }, 64)

    expect(small).toHaveLength(32 * 32)
    expect(large).toHaveLength(64 * 64)
  })
})

describe('the PNG it writes', () => {
  it('is a PNG, eight-bit RGB, at the size asked for', () => {
    const png = encodePng(drawFlame(180), 180)

    expect(png.subarray(0, 8)).toEqual(SIGNATURE)
    expect(headerOf(png)).toEqual({ width: 180, height: 180, depth: 8, colourType: 2 })
    expect(chunksIn(png)).toEqual(['IHDR', 'IDAT', 'IEND'])
  })

  it('paints the flame over a background rather than leaving it transparent', () => {
    // iOS composites a transparent tile onto white, so the mark would float on a white
    // square on a dark home screen — an opaque tile is one decision instead of the
    // platform's.
    const size = 64
    const pixels = pixelsOf(encodePng(drawFlame(size), size), size)

    expect(colourAt(pixels, size, 0, 0)).toEqual([0x1c, 0x19, 0x17])
    expect(colourAt(pixels, size, 32, 30)).toEqual([0xfb, 0xbf, 0x24])
    expect(colourAt(pixels, size, 32, 12)).toEqual([0xea, 0x58, 0x0c])
  })

  it('draws the same bytes twice, so a tile does not change under a cache', () => {
    expect(encodePng(drawFlame(64), 64)).toEqual(encodePng(drawFlame(64), 64))
  })

  it('answers the same buffer for a size it has already drawn', () => {
    const icons = createFlameIcons()

    expect(icons.png(180)).toBe(icons.png(180))
    expect(icons.png(512)).not.toBe(icons.png(180))
  })
})
