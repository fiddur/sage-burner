import type { FastifyInstance } from 'fastify'

import { apiRoutes, errorResponse, flameIcon, isIconType, MAX_ICON_BYTES } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'

import type { GuardDeps } from '../auth/guards.ts'

import { INSTALLATION_ID, installation, installationIcon } from '../db/schema.ts'
import { noStore } from '../http.ts'

export interface PwaDeps extends GuardDeps {
  now?: () => Date
}

/** The toolbar and the splash screen, from `styles.css`'s light palette. */
const THEME_COLOR = '#c2410c'
const BACKGROUND_COLOR = '#faf7f2'

/**
 * What the software calls itself when the installation has not been named yet.
 *
 * The one place a fallback title is spelled out. `installation.tsx` deliberately
 * has none — showing `Sage Burner` and then replacing it reads as a bug — but a
 * manifest has to answer with something the moment it is asked, and a nameless
 * app cannot be installed at all.
 */
const FALLBACK_NAME = 'Sage Burner'

/**
 * A raster icon is 512 square because the browser made it so before uploading;
 * an SVG has no size worth declaring.
 *
 * `sizes` is a claim about bytes this process never decodes, so it is only as
 * true as the client that sent them — the same trade `account_avatar` makes. The
 * cost of a lie is an admin's own icon looking wrong on their own home screen.
 */
const sizesFor = (contentType: string) => (contentType === 'image/svg+xml' ? 'any' : '512x512')

/**
 * Installability, and the icon it installs (#256).
 *
 * The manifest is served rather than shipped as a file because it carries the
 * installation's own name, which is a database row an admin can change — a static
 * `manifest.webmanifest` would say `Sage Burner` on a deployment called something
 * else, and would need a redeploy to stop.
 */
export const registerPwaRoutes = (app: FastifyInstance, { db, now = () => new Date() }: PwaDeps) => {
  const currentIcon = async () => {
    const [row] = await db
      .select()
      .from(installationIcon)
      .where(eq(installationIcon.id, INSTALLATION_ID))
      .limit(1)

    return row
  }

  app.get(apiRoutes.webManifest.fastify, async (_request, reply) => {
    const [named] = await db
      .select({ title: installation.title })
      .from(installation)
      .where(eq(installation.id, INSTALLATION_ID))
      .limit(1)

    const icon = await currentIcon()

    // `no-cache` for the same reason `/api/installation` uses it: a rename or a new
    // icon that sat invisible in a cache would look exactly like the edit not having
    // worked.
    void reply.header('cache-control', 'no-cache')
    void reply.header('content-type', 'application/manifest+json; charset=utf-8')

    return reply.send(
      JSON.stringify({
        name: named?.title ?? FALLBACK_NAME,
        short_name: named?.title ?? FALLBACK_NAME,
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: THEME_COLOR,
        background_color: BACKGROUND_COLOR,
        icons: [
          {
            // The version is what makes a new icon a new URL, so an installed copy
            // picks it up rather than keeping the one it was installed with.
            src: `${apiRoutes.getInstallationIcon.path()}?v=${icon?.updated_at ?? 'default'}`,
            type: icon?.content_type ?? 'image/svg+xml',
            sizes: sizesFor(icon?.content_type ?? 'image/svg+xml'),
          },
        ],
      }),
    )
  })

  /**
   * The icon itself — the uploaded one, or the app's own flame.
   *
   * Always answers rather than 404ing when unset, so the manifest and the shell can
   * both name one URL unconditionally and nothing has to ask first.
   *
   * Public, because a browser fetching an icon for a home screen is not carrying the
   * app's cookies, and because a logo is not member data.
   *
   * **An uploaded SVG is served as authored** — this process decodes no images and
   * strips nothing. An SVG can carry script, but only when it is the top-level
   * document: as a manifest icon or inside an `<img>` it cannot execute. The header
   * closes the one remaining way in, somebody navigating straight to this URL, by
   * giving that document an opaque origin and no scripting. Admin-only upload is the
   * other half of the answer.
   */
  app.get(apiRoutes.getInstallationIcon.fastify, async (_request, reply) => {
    const row = await currentIcon()

    return reply
      .header('content-type', row?.content_type ?? 'image/svg+xml')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('cache-control', 'no-cache')
      .send(row?.image ?? Buffer.from(flameIcon(), 'utf8'))
  })

  app.put(apiRoutes.setInstallationIcon.fastify, { bodyLimit: MAX_ICON_BYTES }, async (request, reply) => {
    void noStore(reply)

    const type = request.headers['content-type']
    if (!isIconType(type)) return reply.code(415).send(errorResponse('bad_request'))

    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      return reply.code(400).send(errorResponse('bad_request'))
    }

    const updated_at = now().toISOString()

    await db
      .insert(installationIcon)
      .values({ id: INSTALLATION_ID, image: request.body, content_type: type, updated_at })
      .onConflictDoUpdate({
        target: installationIcon.id,
        set: { image: request.body, content_type: type, updated_at },
      })

    return { icon: updated_at }
  })

  app.delete(apiRoutes.removeInstallationIcon.fastify, async (_request, reply) => {
    void noStore(reply)

    await db.delete(installationIcon).where(eq(installationIcon.id, INSTALLATION_ID))

    return reply.code(204).send()
  })
}
