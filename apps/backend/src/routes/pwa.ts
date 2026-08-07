import type { FastifyInstance } from 'fastify'

import { apiRoutes, flameIcon, isIconType, MAX_ICON_BYTES } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'

import { INSTALLATION_ID, installation, installationIcon } from '../db/schema.ts'
import { noStore, sendError } from '../http.ts'

export interface PwaDeps extends GuardDeps {
  now: () => Date
}

/** The toolbar, from `styles.css`. The same `--ember` in both palettes' neighbourhood. */
const THEME_COLOR = '#c2410c'

/**
 * The splash screen, and on Android the strip behind the gesture bar.
 *
 * The **dark** palette's paper rather than the light one's. A manifest colour is a
 * single fixed value with no way to follow `prefers-color-scheme`, so one of the two
 * is going to be wrong — and this one is wrong for the length of a launch in light
 * mode against being wrong for as long as the app is open in dark mode, which is
 * where most phones are. It also sits flush against an icon with a dark ground,
 * which the uploaded ones tend to have.
 */
const BACKGROUND_COLOR = '#1c1917'

/**
 * What the software calls itself when the installation has not been named yet.
 *
 * The one place a fallback title is spelled out. `installation.tsx` deliberately
 * has none — showing `Sage Burner` and then replacing it reads as a bug — but a
 * manifest has to answer with something the moment it is asked, and a nameless
 * app cannot be installed at all. The share card takes it from here for the same
 * reason: a crawler asks once and gets whatever was in the head.
 */
export const FALLBACK_NAME = 'Sage Burner'

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
 * What the icon is and when it changed, without reading the bytes.
 *
 * The manifest needs both and the image neither; the share card, which asks on every
 * page load that is not an API call, needs the same two. Half a megabyte of blob
 * fetched to build a URL is what this exists to avoid.
 */
export const iconVersion = async (
  db: Database,
): Promise<{ content_type: string; updated_at: string } | undefined> => {
  const [row] = await db
    .select({ content_type: installationIcon.content_type, updated_at: installationIcon.updated_at })
    .from(installationIcon)
    .where(eq(installationIcon.id, INSTALLATION_ID))
    .limit(1)

  return row
}

/**
 * Installability, and the icon it installs (#256).
 *
 * The manifest is served rather than shipped as a file because it carries the
 * installation's own name, which is a database row an admin can change — a static
 * `manifest.webmanifest` would say `Sage Burner` on a deployment called something
 * else, and would need a redeploy to stop.
 */
export const registerPwaRoutes = (app: FastifyInstance, { db, now }: PwaDeps) => {
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

    const icon = await iconVersion(db)
    const contentType = icon?.content_type ?? 'image/svg+xml'
    const entry = {
      // The version is what makes a new icon a new URL, so an installed copy
      // picks it up rather than keeping the one it was installed with.
      src: `${apiRoutes.getInstallationIcon.path()}?v=${icon?.updated_at ?? 'default'}`,
      type: contentType,
      sizes: sizesFor(contentType),
    }

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
            ...entry,
            // An uploaded icon is maskable as well as plain, and that is what stops
            // Android drawing a white plate behind it: with no maskable icon the
            // launcher makes its own adaptive one by shrinking the plain icon onto a
            // white circle, so a logo with its own background comes out ringed in
            // white. Saying maskable hands the launcher an edge-to-edge image.
            //
            // **One entry with both purposes, not one entry per purpose.** The same
            // `src` listed twice is legal and is what this was first, and Firefox on
            // Android answered it by killing Pixel Launcher on "add to home screen" —
            // a 512-square bitmap decodes to exactly the 1 MB a binder transaction
            // may carry, so passing it twice is over. A file serving both roles says
            // so with a token list, which is also the spelling the spec intends.
            //
            // The app's own flame stays plain: it is an emoji in the top left of its
            // box, and a circular mask would cut it. An admin's file is the admin's
            // to pad, on the same reasoning as serving their SVG as authored.
            purpose: icon === undefined ? 'any' : 'any maskable',
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
    if (!isIconType(type)) return sendError(reply, 415)

    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      return sendError(reply, 400)
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
