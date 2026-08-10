import type { FastifyInstance } from 'fastify'

import { apiRoutes, BANNER_TYPE, isBannerType, MAX_BANNER_BYTES } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'

import { INSTALLATION_ID, installationBanner } from '../db/schema.ts'
import { noStore, sendError } from '../http.ts'

export interface BannerDeps extends GuardDeps {
  now: () => Date
}

export const bannerVersion = async (db: Database): Promise<string | undefined> => {
  const [row] = await db
    .select({ updated_at: installationBanner.updated_at })
    .from(installationBanner)
    .where(eq(installationBanner.id, INSTALLATION_ID))
    .limit(1)

  return row?.updated_at
}

export const registerBannerRoutes = (app: FastifyInstance, { db, now }: BannerDeps) => {
  app.get(apiRoutes.getInstallationBanner.fastify, async (_request, reply) => {
    const [row] = await db
      .select({ image: installationBanner.image })
      .from(installationBanner)
      .where(eq(installationBanner.id, INSTALLATION_ID))
      .limit(1)

    if (row === undefined) return sendError(reply, 404)

    return reply
      .header('content-type', BANNER_TYPE)
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('cache-control', 'no-cache')
      .send(row.image)
  })

  app.put(
    apiRoutes.setInstallationBanner.fastify,
    { bodyLimit: MAX_BANNER_BYTES },
    async (request, reply) => {
      void noStore(reply)

      if (!isBannerType(request.headers['content-type'])) return sendError(reply, 415)

      if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
        return sendError(reply, 400)
      }

      const updated_at = now().toISOString()

      await db
        .insert(installationBanner)
        .values({ id: INSTALLATION_ID, image: request.body, updated_at })
        .onConflictDoUpdate({
          target: installationBanner.id,
          set: { image: request.body, updated_at },
        })

      return { banner: updated_at }
    },
  )

  app.delete(apiRoutes.removeInstallationBanner.fastify, async (_request, reply) => {
    void noStore(reply)

    await db.delete(installationBanner).where(eq(installationBanner.id, INSTALLATION_ID))

    return reply.code(204).send()
  })
}
