import { IMAGE_PIXELS, IMAGE_UPLOAD_TYPE } from '@sage-burner/shared'

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
