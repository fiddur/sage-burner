import type { FastifyInstance } from 'fastify'

import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
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

/** Path only — `request.url` carries the query string, which is not part of the route. */
const pathnameOf = (url: string) => url.split('?')[0] ?? url

const isApiRequest = (pathname: string) => pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`)

/**
 * A request for a file rather than a client-side route.
 *
 * Client routes here are word segments (`/apply`, `/invite/:token`,
 * `/admin/members`) and carry no extension; assets always do. The distinction
 * matters because Vite emits content-hashed chunks and Watchtower swaps the
 * image under live clients — so a page on the previous build will ask for a
 * chunk that no longer exists. Answering that with the HTML shell and a 200
 * produces `Failed to load module script: Expected a JavaScript module script
 * but the server responded with a MIME type of text/html`, which is a much
 * worse thing to debug than a 404.
 */
const looksLikeAsset = (pathname: string) => path.extname(pathname) !== ''

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
    await app.register(fastifyStatic, {
      root: path.resolve(webRoot),
      // A `/*` route would swallow every unmatched request before the
      // not-found handler below ever ran, taking the API's 404s with it.
      wildcard: false,
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
