import { z } from 'zod'

/**
 * `GET /api/version`.
 *
 * Deliberately just the build SHA. This is the container healthcheck, so it is
 * reachable by anything that can reach the container — not a place to expose
 * the environment, the database path, or dependency versions.
 */
export const versionResponseSchema = z.object({
  build_sha: z.string(),
})

export type VersionResponse = z.infer<typeof versionResponseSchema>
