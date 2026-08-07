import { apiRoutes, flameIcon, notificationBadge } from '@sage-burner/shared'

/**
 * The tab icon: this installation's own mark, with a dot when something is waiting
 * (#248, #285).
 *
 * The dot used to be drawn as a `<circle>` inside an SVG data URL, which is why the
 * tab wore the flame while the home screen wore the admin's upload — a data URL
 * cannot reference an external image to draw over. So the uploaded one is loaded into
 * an image and composed with the dot on a canvas instead: the same trick the upload
 * path already uses, since icons are cut square and resized in the browser. Nothing
 * new is fetched that the page was not already entitled to, and the icon is
 * same-origin, so the canvas is not tainted.
 *
 * The flame stays the floor under it. It is set first and synchronously, because
 * composing needs a fetch and a tab must not flicker through a blank icon meanwhile —
 * and it is what remains if the fetch fails, if the browser will not draw an SVG with
 * no intrinsic size, or if there is no 2D context at all. That is the whole failure
 * story: the icon is never worse than it was before #285.
 *
 * Returns a function restoring the plain one, so a caller in an effect can hand it
 * straight back as the cleanup.
 */
const ICON_ID = 'app-favicon'

/** How big the composed icon is drawn. The mark's own square, so nothing scales. */
const SIZE = notificationBadge.box

const flameUrl = (badged: boolean) => `data:image/svg+xml,${encodeURIComponent(flameIcon({ badged }))}`

/** Enough of a canvas to draw on, so a test can supply one. */
export interface BadgeCanvas {
  width: number
  height: number
  getContext: (kind: '2d') => CanvasRenderingContext2D | null
  toDataURL: (type?: string) => string
}

/**
 * The dot's place on a canvas of this size, from the numbers the SVG draws with.
 *
 * Scaled rather than hardcoded: `notificationBadge` is stated once, in the square the
 * flame's viewBox uses, and both drawings derive from it.
 */
export const badgeSpot = (size: number) => ({
  x: (notificationBadge.cx / notificationBadge.box) * size,
  y: (notificationBadge.cy / notificationBadge.box) * size,
  radius: (notificationBadge.r / notificationBadge.box) * size,
  stroke: (notificationBadge.strokeWidth / notificationBadge.box) * size,
})

/**
 * The icon with the dot over it, or nothing if this browser will not draw it.
 *
 * Nothing rather than a half-drawn icon: the caller keeps the flame it already set,
 * which is the answer to every way this can fail.
 */
export const composeBadged = (
  image: CanvasImageSource,
  badged: boolean,
  canvas: BadgeCanvas,
): string | undefined => {
  // Before the context is asked for: assigning a canvas's width resets everything
  // drawn on it, so doing it afterwards would throw the first drawing away.
  canvas.width = SIZE
  canvas.height = SIZE

  const context = canvas.getContext('2d')
  if (context === null) return undefined

  // Sized explicitly rather than drawn at its natural size: `flameIcon` declares a
  // viewBox and no width, and an SVG with no intrinsic size draws as nothing in some
  // browsers unless the destination rectangle says how big it is.
  context.drawImage(image, 0, 0, SIZE, SIZE)

  if (badged) {
    const spot = badgeSpot(SIZE)

    context.beginPath()
    context.arc(spot.x, spot.y, spot.radius, 0, Math.PI * 2)
    context.fillStyle = notificationBadge.fill
    context.fill()
    context.lineWidth = spot.stroke
    context.strokeStyle = notificationBadge.stroke
    context.stroke()
  }

  return canvas.toDataURL('image/png')
}

const loadInstallationIcon = (): Promise<HTMLImageElement | undefined> =>
  new Promise((resolve) => {
    const image = new globalThis.Image()

    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', () => resolve(undefined))
    image.src = apiRoutes.getInstallationIcon.path()
  })

const draw = async (badged: boolean): Promise<string | undefined> => {
  const image = await loadInstallationIcon()
  if (image === undefined) return undefined

  return composeBadged(image, badged, globalThis.document.createElement('canvas'))
}

export const markFavicon = (badged: boolean): (() => void) => {
  const head = globalThis.document?.head
  if (head === undefined) return () => undefined

  const link =
    head.querySelector<HTMLLinkElement>(`link#${ICON_ID}`) ??
    (() => {
      const made = globalThis.document.createElement('link')
      made.id = ICON_ID
      made.rel = 'icon'
      head.append(made)
      return made
    })()

  link.href = flameUrl(badged)

  // Guarded, or a slow draw for the badged state lands after the cleanup that was
  // meant to clear it and leaves a dot on a tab with nothing waiting.
  let live = true
  void draw(badged).then((composed) => {
    if (live && composed !== undefined) link.href = composed
  })

  return () => {
    live = false
    link.href = flameUrl(false)
  }
}
