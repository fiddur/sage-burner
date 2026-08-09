import { z } from 'zod'

/**
 * `POST /api/images` — the id of what was just stored (#379).
 *
 * The id alone, because the caller builds the URL from `apiRoutes.storedImage.path`
 * like every other path in the app. Answering a URL as well would be a second spelling
 * of one endpoint, which is the thing `routes.ts` exists to prevent.
 */
export const imageUploadResponseSchema = z.object({
  id: z.string(),
})

export type ImageUploadResponse = z.infer<typeof imageUploadResponseSchema>

/**
 * One stored picture, as its owner sees it in the list of them (#392).
 *
 * The id and when it was stored, and nothing else. There is no title to give one — the
 * markdown that references it is somewhere in somebody's prose and no foreign key can find
 * it — so the list draws the pictures themselves and the date is what puts them in order.
 */
export const storedImageSchema = z.object({
  id: z.string(),
  created_at: z.string(),
})

export type StoredImage = z.infer<typeof storedImageSchema>

/**
 * `GET /api/me/images` — every picture this account has stored.
 *
 * It exists because `MAX_IMAGES_PER_ACCOUNT` counts every row ever written and nothing
 * else frees one: an account that reached the ceiling could not upload again by any action
 * the app offered. A cap has to be recoverable from, which means being able to see what is
 * held and take one off.
 */
export const myImagesResponseSchema = z.object({ images: z.array(storedImageSchema) })

export type MyImagesResponse = z.infer<typeof myImagesResponseSchema>
