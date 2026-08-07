import { BANNER_HEIGHT, BANNER_TYPE, BANNER_WIDTH } from '@sage-burner/shared'

/**
 * A chosen file, as the bytes the banner route will take (#306).
 *
 * Drawn to 1200 × 630 here rather than on the server, exactly as an avatar and the app
 * icon are: nothing in that process decodes an image, so nothing there has to be
 * trusted to do it safely. It also means `og:image:width` can be declared without
 * measuring anything — this is what makes it true.
 */

/** What the file input offers. Anything a canvas can draw; what goes up is a JPEG. */
export const BANNER_ACCEPT = 'image/*'

/**
 * The widest 1200 : 630 rectangle inside a picture, centred.
 *
 * A card is a fixed shape and a photograph is whatever shape it is, so one of the two
 * has to give. Cropping keeps the middle at full size; scaling to fit would squash a
 * portrait into a letterbox, which is the one result nobody would choose on purpose.
 *
 * The arithmetic lives here, and is tested, because the drawing around it cannot be:
 * happy-dom has no canvas that draws.
 */
export const coverCrop = (
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } => {
  const ratio = BANNER_WIDTH / BANNER_HEIGHT
  const tooTall = width / height < ratio

  const cropped = tooTall ? { width, height: width / ratio } : { width: height * ratio, height }

  return {
    x: (width - cropped.width) / 2,
    y: (height - cropped.height) / 2,
    ...cropped,
  }
}

/**
 * Not unit-tested past `coverCrop`, and cannot usefully be: happy-dom has no canvas
 * that draws, so a test would assert against a stub of the thing under test.
 */
export const preparedBanner = async (file: Blob): Promise<Blob> => {
  const bitmap = await createImageBitmap(file)

  try {
    const { x, y, width, height } = coverCrop(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = BANNER_WIDTH
    canvas.height = BANNER_HEIGHT

    const context = canvas.getContext('2d')
    if (context === null) throw new Error('no canvas')

    context.drawImage(bitmap, x, y, width, height, 0, 0, BANNER_WIDTH, BANNER_HEIGHT)

    const blob = await new Promise<Blob | null>((resolve) => {
      // JPEG at a quality a photograph survives, because that is what a banner is —
      // and because every crawler draws one. A PNG of the same picture is a megabyte
      // the public homepage would then load.
      canvas.toBlob(resolve, BANNER_TYPE, 0.9)
    })

    if (blob === null) throw new Error('could not read that picture')

    return blob
  } finally {
    bitmap.close()
  }
}
