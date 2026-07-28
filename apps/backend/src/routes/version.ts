import type { VersionResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import type { Config } from '../config.ts'

/**
 * `GET /api/version` — unauthenticated, and the container healthcheck.
 *
 * The response shape lives in `@sage-burner/shared` rather than here: it
 * crosses the API boundary, so the web app must be able to import it without
 * reaching into the backend.
 */
export const registerVersionRoutes = (app: FastifyInstance, { config }: { config: Config }) => {
  app.get('/api/version', async (): Promise<VersionResponse> => ({ build_sha: config.build_sha }))
}
