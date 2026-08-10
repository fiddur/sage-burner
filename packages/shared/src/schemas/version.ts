import { z } from 'zod'

export const versionResponseSchema = z.object({
  build_sha: z.string(),
})

export type VersionResponse = z.infer<typeof versionResponseSchema>
