import { z } from 'zod'

export const imageUploadResponseSchema = z.object({
  id: z.string(),
})

export type ImageUploadResponse = z.infer<typeof imageUploadResponseSchema>

export const storedImageSchema = z.object({
  id: z.string(),
  created_at: z.string(),
})

export type StoredImage = z.infer<typeof storedImageSchema>

export const myImagesResponseSchema = z.object({ images: z.array(storedImageSchema) })

export type MyImagesResponse = z.infer<typeof myImagesResponseSchema>
