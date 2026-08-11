import type { FlameShape, Point, TouchIconSize } from '@sage-burner/shared'

import { FLAME_BACKGROUND, FLAME_BOX, FLAME_SHAPES } from '@sage-burner/shared'
import { deflateSync } from 'node:zlib'

const SUB_ROWS = 4

const CURVE_STEPS = 24

const rgbOf = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
]

const at = (from: number, c1: number, c2: number, to: number, t: number): number => {
  const u = 1 - t

  return u * u * u * from + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * to
}

const MARGIN = 0.1

const outline = ({ from, curves }: FlameShape, size: number): Point[] => {
  const scale = (size * (1 - 2 * MARGIN)) / FLAME_BOX
  const offset = size * MARGIN
  const placed = (value: number): number => value * scale + offset

  const points: Point[] = [[placed(from[0]), placed(from[1])]]
  let start = from

  for (const curve of curves) {
    for (let step = 1; step <= CURVE_STEPS; step += 1) {
      const t = step / CURVE_STEPS
      points.push([
        placed(at(start[0], curve.c1[0], curve.c2[0], curve.to[0], t)),
        placed(at(start[1], curve.c1[1], curve.c2[1], curve.to[1], t)),
      ])
    }
    start = curve.to
  }

  return points
}

const overlap = (from: number, to: number, pixel: number): number =>
  Math.max(0, Math.min(to, pixel + 1) - Math.max(from, pixel))

interface Crossing {
  x: number
  winding: number
}

const crossingsAt = (points: readonly Point[], y: number): Crossing[] => {
  const found: Crossing[] = []

  for (let index = 0; index < points.length; index += 1) {
    const one = points[index] ?? [0, 0]
    const other = points[(index + 1) % points.length] ?? [0, 0]
    if (one[1] === other[1]) continue
    if (y < Math.min(one[1], other[1]) || y >= Math.max(one[1], other[1])) continue

    found.push({
      x: one[0] + ((y - one[1]) / (other[1] - one[1])) * (other[0] - one[0]),
      winding: other[1] > one[1] ? 1 : -1,
    })
  }

  return found.sort((one, other) => one.x - other.x)
}

export const coverageOf = (shape: FlameShape, size: number): Float32Array => {
  const points = outline(shape, size)
  const cover = new Float32Array(size * size)
  const share = 1 / SUB_ROWS

  for (let row = 0; row < size * SUB_ROWS; row += 1) {
    const y = (row + 0.5) / SUB_ROWS
    const crossings = crossingsAt(points, y)
    const line = Math.floor(y) * size
    let winding = 0

    for (let index = 0; index < crossings.length - 1; index += 1) {
      winding += crossings[index]?.winding ?? 0
      if (winding === 0) continue

      const from = Math.max(0, crossings[index]?.x ?? 0)
      const to = Math.min(size, crossings[index + 1]?.x ?? 0)

      for (let pixel = Math.floor(from); pixel < to; pixel += 1) {
        cover[line + pixel] = (cover[line + pixel] ?? 0) + overlap(from, to, pixel) * share
      }
    }
  }

  return cover
}

const CRC_TABLE = Array.from({ length: 256 }, (_unused, byte) => {
  let value = byte
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xed_b8_83_20 ^ (value >>> 1) : value >>> 1

  return value >>> 0
})

const crc32 = (bytes: Buffer): number => {
  let value = 0xff_ff_ff_ff
  for (const byte of bytes) value = (CRC_TABLE[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8)

  return (value ^ 0xff_ff_ff_ff) >>> 0
}

const chunk = (type: string, body: Buffer): Buffer => {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(body.length)
  const tagged = Buffer.concat([Buffer.from(type, 'ascii'), body])
  const check = Buffer.alloc(4)
  check.writeUInt32BE(crc32(tagged))

  return Buffer.concat([length, tagged, check])
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const COLOUR_TYPE_RGB = 2

export const encodePng = (pixels: Buffer, size: number): Buffer => {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.writeUInt8(8, 8)
  header.writeUInt8(COLOUR_TYPE_RGB, 9)

  const rows = Buffer.alloc(size * (size * 3 + 1))
  for (let row = 0; row < size; row += 1) {
    pixels.copy(rows, row * (size * 3 + 1) + 1, row * size * 3, (row + 1) * size * 3)
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

export const drawFlame = (size: number): Buffer => {
  const pixels = Buffer.alloc(size * size * 3)
  const [red, green, blue] = rgbOf(FLAME_BACKGROUND)
  for (let pixel = 0; pixel < size * size; pixel += 1) {
    pixels[pixel * 3] = red
    pixels[pixel * 3 + 1] = green
    pixels[pixel * 3 + 2] = blue
  }

  for (const shape of FLAME_SHAPES) {
    const cover = coverageOf(shape, size)
    const paint = rgbOf(shape.fill)

    for (let pixel = 0; pixel < size * size; pixel += 1) {
      const alpha = Math.min(1, cover[pixel] ?? 0)
      if (alpha === 0) continue

      for (let channel = 0; channel < 3; channel += 1) {
        const under = pixels[pixel * 3 + channel] ?? 0
        pixels[pixel * 3 + channel] = Math.round(under + ((paint[channel] ?? 0) - under) * alpha)
      }
    }
  }

  return pixels
}

export const createFlameIcons = (): { png: (size: TouchIconSize) => Buffer } => {
  const drawn = new Map<number, Buffer>()

  return {
    png: (size) => {
      const held = drawn.get(size)
      if (held !== undefined) return held

      const made = encodePng(drawFlame(size), size)
      drawn.set(size, made)

      return made
    },
  }
}
