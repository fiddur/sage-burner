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
