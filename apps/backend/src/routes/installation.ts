import type { InstallationResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes, installationUpdateSchema } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'

import type { GuardDeps } from '../auth/guards.ts'

import { INSTALLATION_ID, installation } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'

/**
 * What this deployment calls itself.
 *
 * `Sage Burner` is the software; the installation is "The Burning Sage" or
 * whatever the people running it call their burns. Editable rather than
 * configured, because renaming the thing you are part of should not need an
 * operator, a redeploy, or a fork.
 */
export const registerInstallationRoutes = (app: FastifyInstance, { db }: GuardDeps) => {
  const current = async () => {
    const [row] = await db
      .select({ title: installation.title })
      .from(installation)
      .where(eq(installation.id, INSTALLATION_ID))
      .limit(1)

    return row
  }

  app.get(apiRoutes.getInstallation.fastify, async (_request, reply) => {
    // `no-cache` rather than `no-store`: the title is public, but it is in the
    // header of every page, so a rename sitting invisible in a browser cache
    // would look exactly like the edit not having worked. Same reasoning as
    // `/api/events/active`.
    void reply.header('cache-control', 'no-cache')

    const found = await current()
    if (found === undefined) return sendError(reply, 404)

    return { installation: found } satisfies InstallationResponse
  })

  app.patch(apiRoutes.updateInstallation.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(installationUpdateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    // `set({})` is not valid SQL, so an empty body would be a 500 rather than
    // the no-op it plainly is.
    if (Object.keys(body).length > 0) {
      await db.update(installation).set(body).where(eq(installation.id, INSTALLATION_ID))
    }

    const found = await current()
    if (found === undefined) return sendError(reply, 404)

    return { installation: found } satisfies InstallationResponse
  })
}
