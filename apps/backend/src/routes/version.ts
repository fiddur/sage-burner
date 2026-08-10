import type { VersionResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes } from '@sage-burner/shared'

import type { Config } from '../config.ts'

export const registerVersionRoutes = (app: FastifyInstance, { config }: { config: Config }) => {
  app.get(
    apiRoutes.getVersion.fastify,
    async (): Promise<VersionResponse> => ({ build_sha: config.build_sha }),
  )
}
