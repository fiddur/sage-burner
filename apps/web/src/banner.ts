import { BANNER_HEIGHT, BANNER_TYPE, BANNER_WIDTH } from '@sage-burner/shared'

export const BANNER_ACCEPT = 'image/*'

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
      canvas.toBlob(resolve, BANNER_TYPE, 0.9)
    })

    if (blob === null) throw new Error('could not read that picture')

    return blob
  } finally {
    bitmap.close()
  }
}
