import { ICON_PIXELS, ICON_TYPES } from '@sage-burner/shared'

import { squareCrop } from './avatar.ts'

export const ICON_ACCEPT = ICON_TYPES.join(',')

export const isSvg = (file: Blob): boolean => file.type === 'image/svg+xml'

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
      canvas.toBlob(resolve, 'image/png')
    })

    if (blob === null) throw new Error('could not read that picture')

    return blob
  } finally {
    bitmap.close()
  }
}
