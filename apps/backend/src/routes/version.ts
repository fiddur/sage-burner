import type { FastifyInstance } from 'fastify'

import type { Config } from '../config.ts'

export interface VersionResponse {
  build_sha: string
}

/**
 * `GET /api/version` — unauthenticated, and the container healthcheck.
 *
 * Deliberately returns only the build SHA. A healthcheck endpoint is reachable
 * by anything that can reach the container, so it is not a place to expose the
 * environment, the database path, or dependency versions.
 */
export const registerVersionRoutes = (app: FastifyInstance, { config }: { config: Config }) => {
  app.get('/api/version', async (): Promise<VersionResponse> => ({ build_sha: config.build_sha }))
}
