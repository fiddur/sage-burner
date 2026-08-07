import { apiRoutes } from '@sage-burner/shared'

/** The one icon link, declared in `index.html` so a signed-out visitor has it too. */
const ICON_ID = 'app-favicon'

/**
 * The unseen-notification dot, stated in the square it is drawn into.
 *
 * Here rather than in `@sage-burner/shared` because only this file draws it. It lived
 * there while `flameIcon` drew a `<circle>` version too, and moved back when that
 * went (#285) — a shared constant with one consumer is a description to keep in step
 * for nothing.
 */
const BADGE = { box: 64, cx: 50, cy: 16, r: 13, fill: '#dc2626', stroke: '#fff', width: 3 } as const

/**
 * How big the composed icon is drawn.
 *
 * An uploaded 512-pixel icon is scaled down to it — a favicon is shown at a fraction
 * of that anyway, and drawing into the badge's own square means its coordinates need
 * no second conversion.
 */
const SIZE = BADGE.box

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
 * Scaled rather than hardcoded, so the numbers stay true if `SIZE` ever changes.
 */
export const badgeSpot = (size: number) => ({
  x: (BADGE.cx / BADGE.box) * size,
  y: (BADGE.cy / BADGE.box) * size,
  radius: (BADGE.r / BADGE.box) * size,
  stroke: (BADGE.width / BADGE.box) * size,
})

/**
 * The icon with the dot over it, or nothing if this browser will not draw it.
 *
 * Nothing rather than a half-drawn icon: the caller keeps the plain icon it already
 * set, which is the answer to every way this can fail.
 */
export const composeBadged = (image: CanvasImageSource, canvas: BadgeCanvas): string | undefined => {
  // Before the context is asked for: assigning a canvas's width resets everything
  // drawn on it, so doing it afterwards would throw the first drawing away.
  canvas.width = SIZE
  canvas.height = SIZE

  const context = canvas.getContext('2d')
  if (context === null) return undefined

  // Sized explicitly rather than drawn at its natural size: an SVG with a viewBox and
  // no width has no intrinsic size, and draws as nothing in some browsers unless the
  // destination rectangle says how big it is.
  context.drawImage(image, 0, 0, SIZE, SIZE)

  const spot = badgeSpot(SIZE)

  context.beginPath()
  context.arc(spot.x, spot.y, spot.radius, 0, Math.PI * 2)
  context.fillStyle = BADGE.fill
  context.fill()
  context.lineWidth = spot.stroke
  context.strokeStyle = BADGE.stroke
  context.stroke()

  return canvas.toDataURL('image/png')
}

/** The installation's icon as an image, or nothing if it will not load. */
const loadIcon = (source: string): Promise<HTMLImageElement | undefined> =>
  new Promise((resolve) => {
    const image = new globalThis.Image()

    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', () => resolve(undefined))
    image.src = source
  })

/**
 * The browser bits the drawing needs, so a test can supply them.
 *
 * Both are here because neither works in happy-dom: an `Image` never fires `load` or
 * `error`, and a canvas has no 2D context — so without them the composed half of this
 * module could only be asserted by reading it.
 */
export interface FaviconBrowser {
  load?: (source: string) => Promise<HTMLImageElement | undefined>
  canvas?: () => BadgeCanvas
}

/**
 * A dot on the tab icon when something is waiting (#248, #285).
 *
 * The icon itself is the installation's own and `index.html` already points the link
 * at the route that serves it — the admin's upload, or the app's flame when there is
 * none. So the tab wears the right mark before any of this runs, signed in or not,
 * and what this adds is the dot.
 *
 * **Drawn on a canvas rather than into the image.** The dot used to be a `<circle>`
 * inside an SVG data URL, which is why the tab wore the flame while the home screen
 * wore the upload: a data URL cannot reference an external image to draw over. This
 * is the same trick the upload path uses, since a chosen file is cut square and
 * resized in the browser. Same-origin, so the canvas is not tainted.
 *
 * **The plain icon is the floor.** It is set synchronously first and only replaced if
 * the drawing succeeds, so a failed fetch, a browser that will not draw an SVG with
 * no intrinsic size, or a missing 2D context all leave the tab wearing the right mark
 * without a dot — never a blank icon, and never somebody else's.
 *
 * Returns a function restoring the plain one, so a caller in an effect can hand it
 * straight back as the cleanup.
 */
export const markFavicon = (badged: boolean, browser: FaviconBrowser = {}): (() => void) => {
  const load = browser.load ?? loadIcon
  const canvas = browser.canvas ?? (() => globalThis.document.createElement('canvas'))

  const head = globalThis.document?.head
  if (head === undefined) return () => undefined

  // Created only if the shell's is missing, which is every test that renders a
  // component rather than the page. Never a second one: two `rel="icon"` links leave
  // it to the browser which wins, and that is how the first attempt at #285 came out
  // doing nothing at all.
  const link =
    head.querySelector<HTMLLinkElement>(`link#${ICON_ID}`) ??
    (() => {
      const made = globalThis.document.createElement('link')
      made.id = ICON_ID
      made.rel = 'icon'
      head.append(made)
      return made
    })()

  const plain = apiRoutes.getInstallationIcon.path()

  link.href = plain
  if (!badged) return () => undefined

  // Guarded, or a slow draw lands after the cleanup that was meant to clear it and
  // leaves a dot on a tab with nothing waiting.
  let live = true

  void load(plain)
    .then((image) => {
      if (!live || image === undefined) return

      const drawn = composeBadged(image, canvas())
      if (drawn !== undefined) link.href = drawn
    })
    // `composeBadged` throws where it cannot return — `toDataURL` on a tainted
    // canvas, `drawImage` refusing an image an engine will not decode. The tab keeps
    // the plain icon either way; this is so it does that without an unhandled
    // rejection, which nothing in this app is watching for.
    .catch(() => undefined)

  return () => {
    live = false
    link.href = plain
  }
}
