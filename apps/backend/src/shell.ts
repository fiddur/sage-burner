import type { FastifyReply, FastifyRequest } from 'fastify'

import {
  BANNER_HEIGHT,
  BANNER_TYPE,
  BANNER_WIDTH,
  bannerSrc,
  ICON_PIXELS,
  iconSrc,
} from '@sage-burner/shared'
import { eq } from 'drizzle-orm'

import type { Config } from './config.ts'
import type { Database } from './db/index.ts'
import type { ShareImage, ShareSubject } from './share.ts'

import { installation, INSTALLATION_ID } from './db/schema.ts'
import { bannerVersion } from './routes/banner.ts'
import { activeEventNow } from './routes/events.ts'
import { FALLBACK_NAME, iconVersion } from './routes/pwa.ts'
import { shareHead } from './share.ts'

export interface ShellDeps {
  db: Database
  config: Config
  now: () => Date
  template: string
}

const HOST = /^(\[[0-9a-f:]+\]|[a-z0-9.-]+)(:\d{1,5})?$/i

export const originOf = (request: FastifyRequest, config: Config): string | undefined => {
  if (config.public_origin !== undefined) return config.public_origin

  const host = request.headers.host

  return typeof host === 'string' && HOST.test(host) ? `${request.protocol}://${host}` : undefined
}

export const prepareShell = (html: string): string => {
  if (!html.includes('</head>')) {
    throw new Error('WEB_ROOT has an index.html with no </head>, so the share card cannot be injected')
  }

  return html
    .replace(/[^\S\n]*<title>[\s\S]*?<\/title>\n?/i, '')
    .replace(/[^\S\n]*<meta\s+name="description"[^>]*>\n?/i, '')
}

const imageFor = (
  banner: string | undefined,
  icon: { content_type: string; updated_at: string } | undefined,
): ShareImage => {
  if (banner !== undefined) {
    return {
      path: bannerSrc(banner),
      type: BANNER_TYPE,
      width: BANNER_WIDTH,
      height: BANNER_HEIGHT,
    }
  }

  const path = iconSrc(icon?.updated_at)

  return icon === undefined || icon.content_type === 'image/svg+xml'
    ? { path, type: icon?.content_type ?? 'image/svg+xml' }
    : { path, type: icon.content_type, width: ICON_PIXELS, height: ICON_PIXELS }
}

const subjectFor = async (
  { db, now }: Pick<ShellDeps, 'db' | 'now'>,
  origin: string | undefined,
): Promise<ShareSubject> => {
  const [named] = await db
    .select({ title: installation.title })
    .from(installation)
    .where(eq(installation.id, INSTALLATION_ID))
    .limit(1)

  const event = await activeEventNow(db, now)

  return {
    installation: named?.title ?? FALLBACK_NAME,
    image: imageFor(await bannerVersion(db), await iconVersion(db)),
    ...(origin === undefined ? {} : { origin }),
    ...(event === undefined ? {} : { event }),
  }
}

export const createShellHandler = (deps: ShellDeps) => {
  const { config, template } = deps

  return async (request: FastifyRequest, reply: FastifyReply) => {
    let subject: ShareSubject = { installation: FALLBACK_NAME }

    try {
      subject = await subjectFor(deps, originOf(request, config))
    } catch (error) {
      request.log.warn({ err: error }, 'building the share card')
    }

    return reply
      .header('content-type', 'text/html; charset=utf-8')
      .header('cache-control', 'no-cache')
      .send(template.replace('</head>', () => `  ${shareHead(subject)}\n  </head>`))
  }
}
