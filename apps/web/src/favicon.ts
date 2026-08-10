import { apiRoutes } from '@sage-burner/shared'

const ICON_ID = 'app-favicon'

const BADGE = { box: 64, cx: 50, cy: 16, r: 13, fill: '#dc2626', stroke: '#fff', width: 3 } as const

const SIZE = BADGE.box

export interface BadgeCanvas {
  width: number
  height: number
  getContext: (kind: '2d') => CanvasRenderingContext2D | null
  toDataURL: (type?: string) => string
}

export const badgeSpot = (size: number) => ({
  x: (BADGE.cx / BADGE.box) * size,
  y: (BADGE.cy / BADGE.box) * size,
  radius: (BADGE.r / BADGE.box) * size,
  stroke: (BADGE.width / BADGE.box) * size,
})

export const composeBadged = (image: CanvasImageSource, canvas: BadgeCanvas): string | undefined => {
  canvas.width = SIZE
  canvas.height = SIZE

  const context = canvas.getContext('2d')
  if (context === null) return undefined

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

const loadIcon = (source: string): Promise<HTMLImageElement | undefined> =>
  new Promise((resolve) => {
    const image = new globalThis.Image()

    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', () => resolve(undefined))
    image.src = source
  })

export interface FaviconBrowser {
  load?: (source: string) => Promise<HTMLImageElement | undefined>
  canvas?: () => BadgeCanvas
}

export const markFavicon = (badged: boolean, browser: FaviconBrowser = {}): (() => void) => {
  const load = browser.load ?? loadIcon
  const canvas = browser.canvas ?? (() => globalThis.document.createElement('canvas'))

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

  const plain = apiRoutes.getInstallationIcon.path()

  link.href = plain
  if (!badged) return () => undefined

  let live = true

  void load(plain)
    .then((image) => {
      if (!live || image === undefined) return

      const drawn = composeBadged(image, canvas())
      if (drawn !== undefined) link.href = drawn
    })
    .catch(() => undefined)

  return () => {
    live = false
    link.href = plain
  }
}
