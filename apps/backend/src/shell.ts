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

/**
 * The single-page app's shell, with this installation's own card in its head (#306).
 *
 * **One handler for every path that serves the shell.** `@fastify/static` registers a
 * route per file, so `/` and `/index.html` *would* come from there, while `/apply`,
 * `/login` and every other client-side route come from the not-found handler.
 * Injecting into one of the two is how sharing the bare domain works and sharing a
 * deep link does not, or the reverse — so `app.ts` keeps `index.html` out of the
 * static glob and points both paths here instead.
 */

export interface ShellDeps {
  db: Database
  config: Config
  now: () => Date
  /** `index.html` as `prepareShell` left it. */
  template: string
}

/**
 * A hostname, as `Host` may spell one.
 *
 * The header is whatever the client sent, and it ends up inside an attribute the
 * crawler will follow — so it is checked for shape as well as escaped. A request that
 * does not say where it arrived gets a card with no `og:url` and no `og:image`, which
 * is the honest answer: both must be absolute.
 */
const HOST = /^(\[[0-9a-f:]+\]|[a-z0-9.-]+)(:\d{1,5})?$/i

/**
 * Where a browser reached this installation.
 *
 * `PUBLIC_ORIGIN` wins where the operator set one; otherwise the request says. The
 * backend deliberately has no notion of its own public address — `docker compose up`
 * has to stay sufficient — and `Host` is what a crawler sends anyway.
 *
 * The scheme comes from `request.protocol`, which follows `X-Forwarded-Proto` only as
 * far as `TRUST_PROXY` allows. Behind Apache with that unset, the card would name
 * `http://` on an https site: the same one line of configuration `Secure` cookies and
 * `request.ip` already depend on.
 */
export const originOf = (request: FastifyRequest, config: Config): string | undefined => {
  if (config.public_origin !== undefined) return config.public_origin

  const host = request.headers.host

  return typeof host === 'string' && HOST.test(host) ? `${request.protocol}://${host}` : undefined
}

/**
 * The shell with the tags this replaces taken out, and a `</head>` to inject before.
 *
 * A second `<title>` would leave it to the browser which one wins, and the static
 * description describes the software rather than this gathering — which is the thing
 * #306 set out to remove rather than to reword. Read once at boot: the file is part of
 * the image and cannot change under a running process.
 *
 * Throws rather than serving what it cannot inject into, on the same argument
 * `assertServableWebRoot` makes: a shell with no `</head>` is a broken build, and a
 * container that will not start is easier to diagnose than one quietly serving the
 * software's name to every crawler.
 */
export const prepareShell = (html: string): string => {
  if (!html.includes('</head>')) {
    throw new Error('WEB_ROOT has an index.html with no </head>, so the share card cannot be injected')
  }

  return html
    .replace(/[^\S\n]*<title>[\s\S]*?<\/title>\n?/i, '')
    .replace(/[^\S\n]*<meta\s+name="description"[^>]*>\n?/i, '')
}

/**
 * The picture the card points at: the banner, or the app icon when there is none.
 *
 * The icon is square, so the card that carries it says `summary` rather than
 * `summary_large_image` — `shareHead` decides that from these dimensions, which is why
 * an SVG declares none: it has no size of its own, and a claimed 512 would get a
 * large card reserving space for a wide picture that does not exist.
 */
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

/**
 * Serve the shell, card and all.
 *
 * A failed read still serves a page, with the software's name on it rather than the
 * installation's: the app fetches its own data and a browser that gets HTML can at
 * least say what is wrong, while a shell whose `<title>` was taken out and never
 * replaced would leave the tab wearing a URL.
 *
 * The replacement is a function so the injected text is taken literally — `$&` and
 * `$'` in a replacement string are patterns, and the welcome text is written by
 * members.
 */
export const createShellHandler = (deps: ShellDeps) => {
  const { config, template } = deps

  return async (request: FastifyRequest, reply: FastifyReply) => {
    let subject: ShareSubject = { installation: FALLBACK_NAME }

    try {
      subject = await subjectFor(deps, originOf(request, config))
    } catch (error) {
      request.log.warn({ err: error }, 'building the share card')
    }

    // `no-cache` for the reason the static shell had it: this is what points at the
    // current asset hashes, and a burn's name changing has to reach a crawler that
    // re-scrapes.
    return reply
      .header('content-type', 'text/html; charset=utf-8')
      .header('cache-control', 'no-cache')
      .send(template.replace('</head>', () => `  ${shareHead(subject)}\n  </head>`))
  }
}
