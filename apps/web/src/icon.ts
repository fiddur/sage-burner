import { ICON_PIXELS, ICON_TYPES } from '@sage-burner/shared'

import { squareCrop } from './avatar.ts'

/**
 * A chosen file, as bytes the icon route will take (#256).
 *
 * An SVG goes up as authored — rasterising a logo to 512 pixels would throw away the
 * reason somebody uploaded one. Everything else goes through a canvas, exactly as an
 * avatar does, which is what lets the server store what it is given without an image
 * library: nothing in that process decodes an image, so nothing there has to be
 * trusted to do it safely.
 */

/** What the file input offers, and what the route accepts. */
export const ICON_ACCEPT = ICON_TYPES.join(',')

export const isSvg = (file: Blob): boolean => file.type === 'image/svg+xml'

/**
 * Not unit-tested past `isSvg`, and cannot usefully be: happy-dom has no canvas that
 * draws, so a test would assert against a stub of the thing under test. `squareCrop`
 * carries the arithmetic and is tested with the avatars that share it; this is the
 * wiring, and it wants a look in a browser.
 */
export const preparedIcon = async (file: Blob): Promise<Blob> => {
  if (isSvg(file)) return file

  const bitmap = await createImageBitmap(file)

  try {
    const { x, y, side } = squareCrop(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = ICON_PIXELS
    canvas.height = ICON_PIXELS

    const context = canvas.getContext('2d')
    if (context === null) throw new Error('no canvas')

    context.drawImage(bitmap, x, y, side, side, 0, 0, ICON_PIXELS, ICON_PIXELS)

    const blob = await new Promise<Blob | null>((resolve) => {
      // PNG rather than WebP, unlike an avatar: this is what a home screen and an
      // installer read, and a logo usually wants the transparency.
      canvas.toBlob(resolve, 'image/png')
    })

    if (blob === null) throw new Error('could not read that picture')

    return blob
  } finally {
    bitmap.close()
  }
}
