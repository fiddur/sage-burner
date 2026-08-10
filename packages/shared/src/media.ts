export const ICON_TYPES = ['image/png', 'image/svg+xml'] as const

export type IconType = (typeof ICON_TYPES)[number]

export const isIconType = (value: unknown): value is IconType =>
  typeof value === 'string' && ICON_TYPES.some((type) => type === value)

export const ICON_PIXELS = 512

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

export const flameIcon = (): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
  `<text y="52" font-size="52">🔥</text>` +
  `</svg>`
