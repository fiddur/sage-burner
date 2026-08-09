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
 * The one thing a share card's image may be (#306).
 *
 * JPEG alone, unlike the two the icon takes. This image exists to be drawn by
 * Facebook, Slack, Signal and the rest, and none of them draws an SVG — accepting
 * one would store a banner that looks right on the homepage and leaves the card
 * blank, which is the bug this was built to fix. PNG renders everywhere but a
 * photograph at this size is a megabyte or more of it, and the banner is the first
 * thing the public homepage loads.
 *
 * The browser produces it from whatever was chosen, exactly as it does an avatar, so
 * nothing here has to decode an image.
 */
export const BANNER_TYPE = 'image/jpeg'

/**
 * One type means the store keeps no `content_type` beside the bytes and the route
 * serves this constant — a column that could only ever hold one value is a column to
 * keep in step for nothing.
 */
export const isBannerType = (value: unknown): value is typeof BANNER_TYPE => value === BANNER_TYPE

/**
 * The rectangle a banner is drawn into before it is sent.
 *
 * 1200 × 630 is what Facebook wants: above about 600 × 315 it draws the large card
 * and below it a thumbnail, and this is the size everyone else's guidance settled on
 * too. Fixed rather than measured, which is what lets `og:image:width` be declared by
 * a process that never decodes an image.
 */
export const BANNER_WIDTH = 1200
export const BANNER_HEIGHT = 630

/**
 * The cap, enforced by Fastify before the body is read.
 *
 * A 1200 × 630 JPEG out of the browser's canvas is a couple of hundred kilobytes, so
 * anything approaching this is a client that skipped the resize or one that means
 * harm. Larger than the icon's because this one is a photograph rather than a logo.
 */
export const MAX_BANNER_BYTES = 1024 * 1024

/**
 * What a picture written into markdown may be stored as (#379).
 *
 * Raster only, whatever `ICON_TYPES` accepts: an SVG can carry script, the icon route
 * defends that with a `default-src 'none'; sandbox` response of its own, and a
 * photograph from a phone is never one. Nothing is gained by opening it.
 *
 * The same three as an avatar's, and for the same reason — every browser this runs in
 * can produce all three from a canvas — but named separately, because the day avatars
 * stop taking one of them is not the day a comment's picture should.
 */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export type ImageType = (typeof IMAGE_TYPES)[number]

export const isImageType = (value: unknown): value is ImageType =>
  typeof value === 'string' && IMAGE_TYPES.some((type) => type === value)

/**
 * What the browser encodes a picture as before sending it.
 *
 * WebP alone, unlike the three that may be stored: it carries transparency, which JPEG
 * would flatten, and a photograph is a good deal smaller in it than in PNG. The wider
 * list stays because bytes stored before this, or by a client that skipped the resize,
 * still have to be served back with the type they came in as.
 */
export const IMAGE_UPLOAD_TYPE = 'image/webp'

/**
 * The longest edge a picture is scaled down to before it is sent.
 *
 * A full-width picture in a thread on a desktop screen is around 700 CSS pixels, so
 * 1600 still has something in hand for a dense display and for somebody opening it in a
 * new tab. A phone camera's 4000 is nothing but bytes here.
 */
export const IMAGE_PIXELS = 1600

/**
 * The cap, enforced by Fastify before the body is read.
 *
 * A 1600-pixel WebP out of the browser's canvas is a couple of hundred kilobytes.
 * Larger than the banner's because this is the one upload that takes whatever a camera
 * produced from a client that may have skipped the resize — and small enough that the
 * database stays a file somebody can back up.
 */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024

/**
 * How many pictures one account may store.
 *
 * This is the first unbounded write any member can make — every other table takes a row
 * per person per thing, and this takes as many as somebody uploads. The cap above bounds
 * one request and not a thousand of them, and #57's rate limiting is still unbuilt, so
 * the ceiling is deliberate rather than absent. At 2 MB apiece it is a gigabyte at worst
 * from one account, and a burn's whole photography is nowhere near it.
 */
export const MAX_IMAGES_PER_ACCOUNT = 500

/**
 * The mark this app wears until somebody uploads their own.
 *
 * Here rather than in either half because both reach for it: the backend serves it
 * as the icon a home screen installs and as what `/api/installation/icon` answers
 * with when nothing has been uploaded, which is also what the tab then wears. Two
 * copies of one emoji would be two things to keep in step for no gain.
 *
 * An emoji rather than an asset, so there is no file to ship, none to cache, and
 * no second image to redraw when the first changes.
 */
export const flameIcon = (): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
  `<text y="52" font-size="52">🔥</text>` +
  `</svg>`
