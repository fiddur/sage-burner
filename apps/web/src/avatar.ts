/** The square the picture is cut down to. Bigger than any circle it is drawn in. */
export const AVATAR_PIXELS = 256

/** What the upload route accepts, and what a canvas can produce in every browser here. */
export const AVATAR_TYPE = 'image/webp'

/**
 * The square crop, as the source's own pixels.
 *
 * A circle wants a square, and a portrait cropped to one from the middle keeps the
 * face far more often than one squashed to fit — which is what an `<img>` scaled to a
 * square would do.
 */
export const squareCrop = (width: number, height: number): { x: number; y: number; side: number } => {
  const side = Math.min(width, height)

  return { x: (width - side) / 2, y: (height - side) / 2, side }
}

/**
 * A picture, cut to a square and sized down, as bytes to upload.
 *
 * **The resizing happens here rather than on the server**, which is what lets the
 * backend store what it is given without an image library: nothing in that process
 * decodes an image, so nothing there has to be trusted to do it safely.
 *
 * Not unit-tested, and cannot usefully be: happy-dom has no canvas that draws, so a
 * test would assert against a stub of the thing under test. `squareCrop` carries the
 * arithmetic; this is the wiring, and it wants a look in a browser.
 */
export const resizedAvatar = async (file: Blob): Promise<Blob> => {
  const bitmap = await createImageBitmap(file)

  try {
    const { x, y, side } = squareCrop(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = AVATAR_PIXELS
    canvas.height = AVATAR_PIXELS

    const context = canvas.getContext('2d')
    if (context === null) throw new Error('no canvas')

    context.drawImage(bitmap, x, y, side, side, 0, 0, AVATAR_PIXELS, AVATAR_PIXELS)

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, AVATAR_TYPE, 0.85)
    })

    if (blob === null) throw new Error('could not read that picture')

    return blob
  } finally {
    bitmap.close()
  }
}
