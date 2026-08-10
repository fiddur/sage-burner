export const ICON_TYPES = ['image/png', 'image/svg+xml'] as const

export type IconType = (typeof ICON_TYPES)[number]

export const isIconType = (value: unknown): value is IconType =>
  typeof value === 'string' && ICON_TYPES.some((type) => type === value)

export const ICON_PIXELS = 512

export const TOUCH_ICON_SIZES = [180, 192, 512] as const

export type TouchIconSize = (typeof TOUCH_ICON_SIZES)[number]

export const TOUCH_ICON_TYPE = 'image/png'

export const MAX_ICON_BYTES = 512 * 1024

export const BANNER_TYPE = 'image/jpeg'

export const isBannerType = (value: unknown): value is typeof BANNER_TYPE => value === BANNER_TYPE

export const BANNER_WIDTH = 1200
export const BANNER_HEIGHT = 630

export const MAX_BANNER_BYTES = 1024 * 1024

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export type ImageType = (typeof IMAGE_TYPES)[number]

export const isImageType = (value: unknown): value is ImageType =>
  typeof value === 'string' && IMAGE_TYPES.some((type) => type === value)

export const IMAGE_UPLOAD_TYPE = 'image/webp'

export const IMAGE_PIXELS = 1600

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024

export const MAX_IMAGES_PER_ACCOUNT = 500

export type Point = readonly [number, number]

export interface FlameCurve {
  c1: Point
  c2: Point
  to: Point
}

export interface FlameShape {
  fill: string
  from: Point
  curves: readonly FlameCurve[]
}

export const FLAME_BOX = 64

export const FLAME_BACKGROUND = '#1c1917'

export const FLAME_SHAPES: readonly FlameShape[] = [
  {
    fill: '#ea580c',
    from: [33, 2],
    curves: [
      { c1: [37, 14], c2: [49, 20], to: [49, 35] },
      { c1: [49, 49], c2: [41, 60], to: [32, 60] },
      { c1: [23, 60], c2: [15, 49], to: [15, 36] },
      { c1: [15, 24], c2: [28, 20], to: [33, 2] },
    ],
  },
  {
    fill: '#fbbf24',
    from: [32, 25],
    curves: [
      { c1: [35, 31], c2: [41, 36], to: [41, 44] },
      { c1: [41, 51], c2: [37, 55], to: [32, 55] },
      { c1: [27, 55], c2: [23, 51], to: [23, 44] },
      { c1: [23, 36], c2: [29, 31], to: [32, 25] },
    ],
  },
]

export const flamePath = ({ from, curves }: FlameShape): string =>
  `M${from[0]} ${from[1]}` +
  curves.map(({ c1, c2, to }) => `C${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${to[0]} ${to[1]}`).join('') +
  'Z'

export const flameIcon = (): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FLAME_BOX} ${FLAME_BOX}">` +
  FLAME_SHAPES.map((shape) => `<path d="${flamePath(shape)}" fill="${shape.fill}"/>`).join('') +
  `</svg>`
