export const AVATAR_PIXELS = 256

export const AVATAR_TYPE = 'image/webp'

export const squareCrop = (width: number, height: number): { x: number; y: number; side: number } => {
  const side = Math.min(width, height)

  return { x: (width - side) / 2, y: (height - side) / 2, side }
}

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
