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

const isApiRequest = (url: string) => url === API_PREFIX || url.startsWith(`${API_PREFIX}/`)

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
    // Behind a reverse proxy in production, so the client address and protocol
    // come from the forwarding headers rather than the socket.
    trustProxy: config.node_env === 'production',
  })

  app.decorate('db', db)
  app.decorate('config', config)

  registerVersionRoutes(app, { config })

  if (config.web_root !== undefined) {
    const root = path.resolve(config.web_root)

    await app.register(fastifyStatic, {
      root,
      // The catch-all is handled below instead, so that a missing asset can be
      // told apart from a client-side route.
      wildcard: false,
    })

    app.setNotFoundHandler((request, reply) => {
      // An unmatched API path is a real 404 — never the SPA shell. Serving
      // HTML to a fetch() that expected JSON turns a clear error into a
      // confusing parse failure at the caller.
      if (isApiRequest(request.url)) {
        return reply.code(404).send({ error: 'not_found' })
      }

      // Anything else is a client-side route: hand back the shell and let the
      // frontend router resolve it. Only GET/HEAD — a POST to a nonexistent
      // path is a mistake, not a page.
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return reply.code(404).send({ error: 'not_found' })
      }

      return reply.sendFile('index.html')
    })
  }

  return app
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Database
    config: Config
  }
}
