import { IMAGE_PIXELS, IMAGE_UPLOAD_TYPE } from '@sage-burner/shared'

/**
 * The size a picture is drawn at, with its shape kept.
 *
 * Never upwards: a small picture pasted from a screenshot would only get blurrier and
 * bigger in bytes for it. `Math.round` rather than `floor`, so a 1601-pixel edge does not
 * come out one pixel short of the cap for no reason.
 */
export const scaledSize = (
  width: number,
  height: number,
  max: number = IMAGE_PIXELS,
): { width: number; height: number } => {
  const longest = Math.max(width, height)
  if (longest <= max) return { width, height }

  const scale = max / longest

  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/**
 * A picture, scaled down, as bytes to upload.
 *
 * **The resizing happens here rather than on the server**, which is what lets the backend
 * store what it is given without an image library — the rule the avatar, the icon and the
 * banner all follow. This is the upload that takes whatever a camera produced, so it is
 * also where that rule matters most.
 *
 * `imageOrientation: 'from-image'` is load-bearing rather than tidy. A phone carries the
 * rotation in EXIF; a canvas round-trip drops the tag and keeps the pixels, so without it
 * a picture that looked upright in the gallery goes up sideways and stays that way.
 *
 * The round-trip also **strips EXIF**, which is worth having on purpose: a phone
 * photograph carries the place it was taken, and this one is going into a thread other
 * people read. It flattens an animated GIF to a single frame, which is why GIF is not in
 * the accepted list.
 *
 * Beyond `scaledSize`'s arithmetic this is wiring, and happy-dom has no canvas that draws
 * — a test of the rest would assert against a stub of the thing under test.
 */
export const resizedImage = async (file: Blob): Promise<Blob> => {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })

  try {
    const { width, height } = scaledSize(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (context === null) throw new Error('no canvas')

    context.drawImage(bitmap, 0, 0, width, height)

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, IMAGE_UPLOAD_TYPE, 0.85)
    })

    if (blob === null) throw new Error('could not read that picture')

    return blob
  } finally {
    bitmap.close()
  }
}
