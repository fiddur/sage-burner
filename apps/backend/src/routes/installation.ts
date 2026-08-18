import type { InstallationResponse, MapLinkResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes, installationUpdateSchema, mapLinkUpdateSchema } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'

import type { GuardDeps } from '../auth/guards.ts'
import type { Config } from '../config.ts'

import { createGuards } from '../auth/guards.ts'
import { isEmptyPatch } from '../db/patch.ts'
import { installation, INSTALLATION_ID } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { mailSettingsFor } from '../mail/mail.ts'
import { configuredProviders } from '../oauth/settings.ts'
import { bannerVersion } from './banner.ts'
import { iconVersion } from './pwa.ts'

export interface InstallationDeps extends GuardDeps {
  config: Config
}

export const registerInstallationRoutes = (
  app: FastifyInstance,
  { db, sessions, config }: InstallationDeps,
) => {
  const { requireApproved } = createGuards({ db, sessions })

  const mapLink = async (): Promise<MapLinkResponse> => {
    const [row] = await db
      .select({ url: installation.map_url })
      .from(installation)
      .where(eq(installation.id, INSTALLATION_ID))
      .limit(1)

    return { map: { url: row?.url ?? null } }
  }

  const current = async (): Promise<InstallationResponse['installation'] | undefined> => {
    const [row] = await db
      .select({ title: installation.title })
      .from(installation)
      .where(eq(installation.id, INSTALLATION_ID))
      .limit(1)

    if (row === undefined) return undefined

    return {
      ...row,
      banner_updated_at: (await bannerVersion(db)) ?? null,
      icon_updated_at: (await iconVersion(db))?.updated_at ?? null,
      sends_email: (await mailSettingsFor(db)) !== undefined,
      knows_own_address: config.public_origin !== undefined,
      social_logins: await configuredProviders(db),
    }
  }

  app.get(apiRoutes.getInstallation.fastify, async (_request, reply) => {
    void reply.header('cache-control', 'no-cache')

    const found = await current()
    if (found === undefined) return sendError(reply, 404)

    return { installation: found } satisfies InstallationResponse
  })

  app.patch(apiRoutes.updateInstallation.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(installationUpdateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    if (!isEmptyPatch(body)) {
      await db.update(installation).set(body).where(eq(installation.id, INSTALLATION_ID))
    }

    const found = await current()
    if (found === undefined) return sendError(reply, 404)

    return { installation: found } satisfies InstallationResponse
  })

  app.get(apiRoutes.getMapLink.fastify, { preHandler: requireApproved }, async (_request, reply) => {
    void reply.header('cache-control', 'no-cache')

    return (await mapLink()) satisfies MapLinkResponse
  })

  app.put(apiRoutes.setMapLink.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(mapLinkUpdateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    await db.update(installation).set({ map_url: body.url }).where(eq(installation.id, INSTALLATION_ID))

    return (await mapLink()) satisfies MapLinkResponse
  })
}
