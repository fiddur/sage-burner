/**
 * What an uploaded image may be, for both halves to agree on. No Zod in reach,
 * for the same reason as `limits.ts`: the web app reads these at runtime and the
 * barrel is what the public homepage's chunk goes through.
 */

/**
 * The two the app icon may be stored as.
 *
 * PNG because that is what a canvas can produce from whatever the admin picked,
 * and SVG because a logo usually *is* one and rasterising it to 512 pixels
 * throws away the thing that made it worth uploading. Deliberately not the wider
 * list avatars take: those come out of a canvas and are therefore always one of
 * three, whereas this is a file chosen from a disk.
 */
export const ICON_TYPES = ['image/png', 'image/svg+xml'] as const

export type IconType = (typeof ICON_TYPES)[number]

export const isIconType = (value: unknown): value is IconType =>
  typeof value === 'string' && ICON_TYPES.some((type) => type === value)

/**
 * The square a raster icon is resized to before it is sent.
 *
 * 512 is what a manifest wants for the largest icon, and what an installing
 * browser scales every smaller one from.
 */
export const ICON_PIXELS = 512

/**
 * The cap, enforced by Fastify before the body is read.
 *
 * A 512-pixel PNG is a fraction of this and a logo's SVG is smaller again, so
 * anything approaching it is a client that skipped the resize or one that means
 * harm.
 */
export const MAX_ICON_BYTES = 512 * 1024

/**
 * The mark this app wears until somebody uploads their own.
 *
 * Here rather than in either half because both draw it: the backend serves it as
 * the icon a home screen installs, and the tab draws the badged variant when a
 * notification is waiting (#248). Two copies of one emoji would be two things to
 * keep in step for no gain — and the whole point of the badge is that it is the
 * *same* mark with a dot on it.
 *
 * An emoji rather than an asset, so there is no file to ship, none to cache, and
 * no second image to redraw when the first changes.
 */
export const flameIcon = ({ badged = false }: { badged?: boolean } = {}): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
  `<text y="52" font-size="52">🔥</text>` +
  (badged ? `<circle cx="50" cy="16" r="13" fill="#dc2626" stroke="#fff" stroke-width="3"/>` : '') +
  `</svg>`
