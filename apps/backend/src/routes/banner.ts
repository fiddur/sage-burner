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

/**
 * When the banner was last uploaded, or `undefined` when there is none.
 *
 * The stamp and not the bytes: `/api/installation` answers with it so the homepage
 * knows whether to draw a banner at all, and the shell puts it in the `?v=` of the
 * card's `og:image`. Selecting the blob to find out whether a row exists would read a
 * few hundred kilobytes on every page load.
 */
export const bannerVersion = async (db: Database): Promise<string | undefined> => {
  const [row] = await db
    .select({ updated_at: installationBanner.updated_at })
    .from(installationBanner)
    .where(eq(installationBanner.id, INSTALLATION_ID))
    .limit(1)

  return row?.updated_at
}

/**
 * The banner: the picture a link to this installation shows, and the one the homepage
 * wears above the burn (#306).
 *
 * The same shape as the icon beside it — public read, admin write, `?v=` on the URL so
 * a new banner is a new URL — with two differences. It is a JPEG and can be nothing
 * else, because its whole job is to be drawn by crawlers that will not draw an SVG.
 * And a missing one is a 404 rather than a default: the icon route always answers
 * because the manifest names it unconditionally, whereas nothing asks for this until
 * `/api/installation` has said there is one.
 *
 * Nothing here decodes an image. The browser draws it to 1200 × 630 before sending,
 * which is what lets `og:image:width` be declared by a process with no image library
 * — the same trade the manifest's `sizes` makes, and worth the same caveat: those
 * numbers are only as true as the client that sent the bytes.
 */
export const registerBannerRoutes = (app: FastifyInstance, { db, now }: BannerDeps) => {
  app.get(apiRoutes.getInstallationBanner.fastify, async (_request, reply) => {
    const [row] = await db
      .select({ image: installationBanner.image })
      .from(installationBanner)
      .where(eq(installationBanner.id, INSTALLATION_ID))
      .limit(1)

    if (row === undefined) return sendError(reply, 404)

    return (
      reply
        .header('content-type', BANNER_TYPE)
        .header('x-content-type-options', 'nosniff')
        // A JPEG cannot execute, so this is belt to the type's braces — but the bytes
        // are whatever an admin uploaded and are served back with a type nothing here
        // verified, which is exactly the icon's situation.
        .header('content-security-policy', "default-src 'none'; sandbox")
        // `no-cache` rather than a long max-age, as the icon has it: the `?v=` would
        // make caching safe for the URLs this app builds, and not for the bare one a
        // crawler may keep — a card showing last year's banner for a year is the
        // failure this whole issue is about.
        .header('cache-control', 'no-cache')
        .send(row.image)
    )
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
