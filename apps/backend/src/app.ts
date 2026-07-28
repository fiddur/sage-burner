import type { FastifyInstance } from 'fastify'

import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'

import type { Config } from './config.ts'
import type { Database } from './db/index.ts'

import { registerVersionRoutes } from './routes/version.ts'

export interface AppDeps {
  db: Database
  config: Config
}

/** The API lives here; everything else is the single-page app. */
const API_PREFIX = '/api'

/**
 * Path only, decoded.
 *
 * `request.url` carries the query string, which is not part of the route, and
 * is percent-encoded — without decoding, `/%61pi/nope` would miss the API
 * branch below and be answered with the SPA shell. Malformed encoding is left
 * as-is rather than throwing; it will not match anything either way.
 */
const pathnameOf = (url: string) => {
  const [raw = url] = url.split('?')
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

const isApiRequest = (pathname: string) => pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`)

/**
 * A request for a file rather than a client-side route.
 *
 * The distinction matters because Vite emits content-hashed chunks and
 * Watchtower swaps the image under live clients — so a page on the previous
 * build will ask for a chunk that no longer exists. Answering that with the
 * HTML shell and a 200 produces `Failed to load module script: Expected a
 * JavaScript module script but the server responded with a MIME type of
 * text/html`, which is much worse to debug than a 404.
 *
 * **This is a rule, not a description: any path whose last segment contains a
 * dot is treated as a file and 404s.** So client-side routes must not embed
 * one — no filenames, no email addresses in a path, and in particular invite
 * tokens must be dot-free for `/invite/:token` to resolve.
 *
 * One wrinkle: `path.extname('/.env')` is `''`, so a dotfile-shaped path gets
 * the shell rather than a 404. Harmless — the static glob skips dotfiles, so
 * there is nothing to serve either way — but the rule is "has an extension",
 * not "contains a dot".
 */
const looksLikeAsset = (pathname: string) => path.extname(pathname) !== ''

/**
 * Refuse to start on a web root that cannot serve the app.
 *
 * `@fastify/static` only *warns* on a missing root and returns, and with
 * `wildcard: false` it globs the directory once at registration — so an absent,
 * empty, or wrong root registers zero routes and the app comes up serving
 * nothing. `/api/version` keeps answering, so the container healthcheck stays
 * green while the entire frontend 404s: a typo'd variable, an unmounted volume,
 * or an image where the web build was never copied all look like this.
 *
 * Setting WEB_ROOT is an explicit statement of intent to serve the app, so not
 * being able to is a boot failure, per the same argument config.ts makes.
 */
const assertServableWebRoot = (root: string): void => {
  const stats = statSync(root, { throwIfNoEntry: false })

  if (stats === undefined) {
    throw new Error(`WEB_ROOT does not exist: ${root}`)
  }
  if (!stats.isDirectory()) {
    throw new Error(`WEB_ROOT is not a directory: ${root}`)
  }
  if (!existsSync(path.join(root, 'index.html'))) {
    throw new Error(`WEB_ROOT has no index.html, so the app cannot be served: ${root}`)
  }
}

/**
 * Build the application.
 *
 * Takes its dependencies as arguments rather than constructing them, so tests
 * can inject an in-memory database and assert against `app.inject()` without a
 * socket, a file, or a running server.
 */
export const createApp = async ({ db, config }: AppDeps): Promise<FastifyInstance> => {
  const app = Fastify({
    logger: {
      level: config.log_level,
      // Pretty output would need a dev-only dependency; JSON lines are what a
      // container's log driver wants anyway.
      redact: {
        // These never belong in a log line, and the whole point of the app is
        // that it holds them.
        paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
        remove: true,
      },
    },
    // Defaults to trusting nothing. `true` would believe the whole
    // X-Forwarded-For chain from whoever connects, making request.ip
    // client-controlled — which matters as soon as a rate limiter on invite
    // redemption or an admin audit trail keys on it. The operator declares
    // what is actually in front via TRUST_PROXY.
    trustProxy: config.trust_proxy,
  })

  app.decorate('db', db)
  app.decorate('config', config)

  registerVersionRoutes(app, { config })

  const webRoot = config.web_root
  const servesWebApp = webRoot !== undefined

  if (webRoot !== undefined) {
    const root = path.resolve(webRoot)
    assertServableWebRoot(root)

    await app.register(fastifyStatic, {
      root,
      // A `/*` route would swallow every unmatched request before the
      // not-found handler below ever ran, taking the API's 404s with it.
      //
      // The trade is that the directory is globbed once, here, and a route
      // registered per file — so files appearing afterwards are never served.
      // Correct for an immutable image; do not point WEB_ROOT at a directory
      // something rebuilds while the process is running.
      wildcard: false,

      setHeaders: (response, filePath) => {
        // Everything under assets/ is content-hashed by Vite, so its name
        // changes whenever its bytes do and it can be cached indefinitely.
        // The shell must not be: it is what points at the current hashes, and
        // caching it is how clients get pinned to a build that no longer
        // exists. Watchtower redeploys on its own schedule, so this is the
        // difference between a new version arriving and never arriving.
        const cacheable = filePath.includes(`${path.sep}assets${path.sep}`)
        response.header('cache-control', cacheable ? 'public, max-age=31536000, immutable' : 'no-cache')
      },
    })
  }

  // Registered unconditionally so the API's 404 body does not change shape
  // between development (Vite serves the frontend, WEB_ROOT unset) and the
  // container (WEB_ROOT set). Frontend error handling written against one
  // would otherwise meet the other in the environment it was not tested in.
  app.setNotFoundHandler((request, reply) => {
    const notFound = () => reply.code(404).send({ error: 'not_found' })
    const pathname = pathnameOf(request.url)

    // An unmatched API path is a real 404 — never the SPA shell. Serving HTML
    // to a fetch() that expected JSON turns a clear error into a confusing
    // parse failure at the caller.
    if (isApiRequest(pathname)) return notFound()

    if (!servesWebApp) return notFound()

    // A POST to a nonexistent path is a mistake, not a page.
    if (request.method !== 'GET' && request.method !== 'HEAD') return notFound()

    // A missing asset is a missing asset, not a client-side route.
    if (looksLikeAsset(pathname)) return notFound()

    return reply.sendFile('index.html')
  })

  return app
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Database
    config: Config
  }
}
