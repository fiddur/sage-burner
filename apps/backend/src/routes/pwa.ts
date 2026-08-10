import type { FastifyInstance } from 'fastify'

import {
  apiRoutes,
  feedPage,
  flameIcon,
  iconSrc,
  isIconType,
  MAX_ICON_BYTES,
  songbookPage,
  TOUCH_ICON_SIZES,
  TOUCH_ICON_TYPE,
  touchIconSrc,
} from '@sage-burner/shared'
import { eq } from 'drizzle-orm'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'

import { installation, INSTALLATION_ID, installationIcon } from '../db/schema.ts'
import { noStore, sendError } from '../http.ts'
import { createFlameIcons } from '../pwa/flame.ts'

export interface PwaDeps extends GuardDeps {
  now: () => Date
}

const THEME_COLOR = '#c2410c'

const BACKGROUND_COLOR = '#1c1917'

export const FALLBACK_NAME = 'Sage Burner'

const sizesFor = (contentType: string) => (contentType === 'image/svg+xml' ? 'any' : '512x512')

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

export const DESCRIPTION = 'Where a small gathering keeps who is coming, what is on and who is cooking.'

const SHORTCUTS: readonly { name: string; url: string }[] = [
  { name: 'Schedule', url: '/schedule' },
  { name: 'Feed', url: feedPage() },
  { name: 'Songbook', url: songbookPage() },
]

export const registerPwaRoutes = (app: FastifyInstance, { db, now }: PwaDeps) => {
  const flames = createFlameIcons()

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
      src: iconSrc(icon?.updated_at),
      type: contentType,
      sizes: sizesFor(contentType),
    }

    void reply.header('cache-control', 'no-cache')
    void reply.header('content-type', 'application/manifest+json; charset=utf-8')

    // The PNG entries are the flame's, so they are declared only where nobody has uploaded an
    // icon. An admin's own SVG stays the single entry it was: putting the app's flame beside
    // somebody's logo would show the wrong mark in the install sheet, and a raster upload is
    // already the 512 it is asked for.
    const drawn =
      icon === undefined
        ? TOUCH_ICON_SIZES.map((size) => ({
            src: touchIconSrc(size, null),
            type: TOUCH_ICON_TYPE,
            sizes: `${size}x${size}`,
            purpose: 'maskable',
          }))
        : []

    return reply.send(
      JSON.stringify({
        id: '/',
        name: named?.title ?? FALLBACK_NAME,
        short_name: named?.title ?? FALLBACK_NAME,
        description: DESCRIPTION,
        lang: 'en',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: THEME_COLOR,
        background_color: BACKGROUND_COLOR,
        icons: [
          {
            ...entry,
            purpose: icon === undefined ? 'any' : 'any maskable',
          },
          ...drawn,
        ],
        shortcuts: SHORTCUTS.map((shortcut) => ({ ...shortcut })),
      }),
    )
  })

  // The upload when it is already a PNG, and the flame otherwise — an SVG upload falling back
  // to the app's own mark is honest, since iOS draws no SVG for a tile and a gray square is what
  // it drew before (#453). Exact spellings only, so one tile is one cache key.
  app.get<{ Params: { size: string } }>(apiRoutes.getTouchIcon.fastify, async (request, reply) => {
    const wanted = TOUCH_ICON_SIZES.find((size) => String(size) === request.params.size)
    if (wanted === undefined) return sendError(reply, 404)

    const row = await currentIcon()
    const uploaded = row?.content_type === TOUCH_ICON_TYPE ? row.image : undefined

    return reply
      .header('content-type', TOUCH_ICON_TYPE)
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('cache-control', 'no-cache')
      .send(uploaded ?? flames.png(wanted))
  })

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
