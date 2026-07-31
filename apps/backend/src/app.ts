import type { FastifyHelmetOptions } from '@fastify/helmet'
import type { FastifyInstance } from 'fastify'

import helmet from '@fastify/helmet'
import fastifyStatic from '@fastify/static'
import { errorResponse } from '@sage-burner/shared'
import Fastify from 'fastify'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'

import type { Config } from './config.ts'
import type { Database } from './db/index.ts'

import { createSessions } from './auth/session.ts'
import { clientErrorHandler, frameworkErrorHandler, registerErrorHandler } from './errors.ts'
import { registerAdminRoutes } from './routes/admin.ts'
import { registerApplicationReviewRoutes } from './routes/application-review.ts'
import { registerApplicationRoutes } from './routes/applications.ts'
import { registerAuthRoutes } from './routes/auth.ts'
import { registerEventRoutes } from './routes/events.ts'
import { registerInviteRoutes } from './routes/invites.ts'
import { registerQuestionRoutes } from './routes/questions.ts'
import { registerVersionRoutes } from './routes/version.ts'

export interface AppDeps {
  db: Database
  config: Config
  /**
   * Injected so the active-event rule can be tested at a fixed date. A test
   * written against the real clock would pass in July and fail in September.
   */
  now?: () => Date
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
 * Logger configuration.
 *
 * Exported so the redaction can be tested against a captured stream rather than
 * against a copy of it — `err.headers` is a real control, its failure mode is
 * silence, and asserting a duplicated list would prove only that a string can
 * be copied.
 *
 * Pretty output would need a dev-only dependency; JSON lines are what a
 * container's log driver wants anyway.
 */
export const loggerOptions = (level: string) => ({
  level,
  redact: {
    // These never belong in a log line, and the whole point of the app is that
    // it holds them.
    //
    // `err.headers` goes wholesale rather than by name. `sendEnvelope`
    // deliberately supports errors that carry headers — a 401 challenge, a rate
    // limiter's Retry-After, a session-clearing set-cookie — and pino's error
    // serializer copies an error's own enumerable properties into the log
    // verbatim, so the supported shape is also the one that would write a live
    // session value to disk.
    //
    // Naming them (`err.headers["set-cookie"]`) does not work: pino matches
    // paths literally, and unlike `req.headers`, which Node lowercases, these
    // keys are whatever the throwing code wrote. `Set-Cookie` is the
    // conventional spelling and would sail straight past. Removing the object
    // is the only form that cannot be defeated by casing. `sendEnvelope` logs
    // the header *names* separately, which is the part worth reading.
    //
    // Of the four, only `err.headers` matches anything today, and it is the
    // only one with a test. Fastify's default serializers in
    // `lib/logger-pino.js` emit `{ method, url, version, host, remoteAddress,
    // remotePort }` for `req` and `{ statusCode }` for `res` — neither carries
    // a `headers` key at all, so the other three can never fire.
    //
    // They stay for the same reason the encodings are in `describesTheBody`:
    // they cost nothing, and the day someone passes a custom serializer is not
    // the day to be discovering it. But they are a hedge, not a control — a
    // typo in one of those three is *permanently* invisible, because nothing
    // will ever reach it.
    paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]', 'err.headers'],
    remove: true,
  },
})

/**
 * Security headers, as deviations from `@fastify/helmet`'s defaults.
 *
 * Annotated rather than inferred. The object is built here and handed to
 * `register()` as a call result, not as a fresh literal at the call site, so
 * TypeScript's excess-property check never fires — `xFrameOption` for
 * `xFrameOptions` compiled clean and silently reverted the header to
 * SAMEORIGIN. The annotation is what catches the next misspelling; a test only
 * covers the options something already asserts.
 *
 * The defaults are close, but four need narrowing: three are looser than this
 * app needs, and `style-src`'s `'unsafe-inline'` is looser than it should be
 * anywhere. Everything not named here is
 * helmet's default and is wanted: `nosniff`, `Referrer-Policy: no-referrer`
 * (stricter than the `strict-origin-when-cross-origin` #41 asked for, and the
 * right call while an invite token lives in a URL path), HSTS,
 * `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy` — but not
 * `Cross-Origin-Embedder-Policy`, which helmet stopped defaulting on in v6
 * because `require-corp` breaks every cross-origin subresource — and
 * `X-XSS-Protection: 0`, which disables a legacy auditor that introduced
 * vulnerabilities of its own.
 */
const helmetOptions = (): FastifyHelmetOptions => ({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      // Helmet defaults to `'self'`, and pairs it with X-Frame-Options
      // SAMEORIGIN. Nothing here frames anything, and approving an application
      // is a one-click action, so the answer is no rather than same-origin.
      'frame-ancestors': ["'none'"],

      // Helmet's default is `'self' https: 'unsafe-inline'`. The inline
      // allowance is the one that matters: with it, an injected `style=` can
      // still be used to overlay or exfiltrate, and CSP stops being a real
      // control. Checked against the build rather than assumed — the app has no
      // inline styles and no `style=` attributes, and `styles.css` uses only
      // system font stacks, so there is no `@font-face` or `url()` to allow.
      'style-src': ["'self'"],
      'font-src': ["'self'"],

      // No <base> is ever emitted, so nothing needs to set one.
      'base-uri': ["'none'"],

      // Helmet's default is `'self' data:`, which contradicted the welcome
      // text's own URL allowlist: `markdown.ts` admits `https://` image
      // sources, so a remote image was rendered into the DOM and then blocked
      // by the browser — the documented behaviour looked like a bug.
      //
      // Widened rather than narrowed because there is no upload feature, so the
      // alternative is that images do not work at all. `https:` only, so an
      // image cannot downgrade the page, and images cannot execute — `script-src`
      // stays `'self'`.
      //
      // The honest cost: an image host an organiser links to sees the IP of
      // every visitor to the homepage. That is the organiser's choice to make in
      // a field only they can write, and it is the only external request this
      // app can produce. An upload feature would remove the need for it, and
      // narrowing this back to `'self' data:` is the change to make if one
      // arrives.
      'img-src': ["'self'", 'data:', 'https:'],
    },
  },

  // Overrides helmet's SAMEORIGIN. The belt to frame-ancestors' braces, for
  // browsers predating it.
  xFrameOptions: { action: 'deny' },
})

/**
 * Session signing, from config.
 *
 * The clock is `() => new Date()` here and injected in tests, which is the only
 * way to assert expiry without a suite that waits two weeks.
 */
const sessionDeps = (config: Config) => ({
  secret: config.session_secret,
  now: () => new Date(),
  ttlSeconds: config.session_ttl_seconds,
})

/**
 * Build the application.
 *
 * Takes its dependencies as arguments rather than constructing them, so tests
 * can inject an in-memory database and assert against `app.inject()` without a
 * socket, a file, or a running server.
 */
export const createApp = async ({
  db,
  config,
  now = () => new Date(),
}: AppDeps): Promise<FastifyInstance> => {
  const app = Fastify({
    logger: loggerOptions(config.log_level),
    // Defaults to trusting nothing. `true` would believe the whole
    // X-Forwarded-For chain from whoever connects, making request.ip
    // client-controlled — which matters as soon as a rate limiter on invite
    // redemption or an admin audit trail keys on it. The operator declares
    // what is actually in front via TRUST_PROXY.
    trustProxy: config.trust_proxy,
    // The other half of the error envelope. `setErrorHandler` covers anything
    // thrown once a request reaches routing; this covers what find-my-way
    // rejects before that — a bad percent escape, an over-long path parameter —
    // which otherwise goes straight to the socket as Fastify's prose.
    frameworkErrors: frameworkErrorHandler,
    // And the third: a request Node's HTTP parser rejects before Fastify sees
    // one at all — an oversized header block, a client timeout. No reply object
    // exists, so this writes the envelope to the socket itself.
    clientErrorHandler,
  })

  // Registered before anything that can answer, so the headers reach the SPA
  // shell and static assets as well as the API — `@fastify/helmet` hooks
  // `onRequest`, and a plugin registered after a route still covers it, but
  // putting it first means there is no ordering to get wrong later.
  await app.register(helmet, helmetOptions())

  // Fastify parses `text/plain` by default, and that is the one body type a
  // cross-site HTML form can send — `enctype="text/plain"` is reachable from
  // any page, while urlencoded and multipart 415 out here.
  //
  // It matters because `SameSite=Lax` protects less than it looks like it does.
  // Lax stops the cookie being *sent* cross-site, which covers every route that
  // needs a session — but logout does not need one. It ignores the body and
  // answers with `Set-Cookie: …; Max-Age=0`, and a Set-Cookie on a top-level
  // cross-site navigation is honoured. So `evil.com` could auto-submit a form
  // and sign a member out. Verified: text/plain answered 200 with the clearing
  // cookie, the other two form encodings answered 415.
  //
  // Nuisance rather than disclosure — nothing moves and the attacker learns
  // nothing — but no route here accepts plain text, so the parser is pure
  // attack surface.
  //
  // Note the scope: this is a property of the *instance*, not of the logout
  // route, and it holds only while no registered parser accepts a form
  // encoding. Registering `@fastify/formbody` later — for a webhook, an admin
  // form post — would reopen it from a file with nothing to do with auth. The
  // `cross-site reachability` block in `routes/auth.test.ts` is what keeps that
  // honest: it asserts all three form encodings answer 415, so the regression
  // fails CI rather than shipping.
  app.removeContentTypeParser('text/plain')

  app.decorate('db', db)
  app.decorate('config', config)

  registerErrorHandler(app)
  registerVersionRoutes(app, { config })

  // One `Sessions` for both, so the guards verify what the login route signed.
  const sessions = createSessions(sessionDeps(config))
  registerAuthRoutes(app, { db, config, sessions })
  registerAdminRoutes(app, { db, sessions })
  registerEventRoutes(app, { db, sessions, now })
  registerQuestionRoutes(app, { db, sessions })
  registerApplicationRoutes(app, { db, now })
  registerApplicationReviewRoutes(app, { db, sessions, now })
  registerInviteRoutes(app, { db, sessions, now })

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
        //
        // Relative to the root, not a substring of the absolute path — which
        // would also match when any ancestor directory happens to be called
        // `assets`, handing the shell an `immutable` no redeploy can bust.
        const cacheable = path.relative(root, filePath).startsWith(`assets${path.sep}`)
        response.header('cache-control', cacheable ? 'public, max-age=31536000, immutable' : 'no-cache')
      },
    })
  }

  // Registered unconditionally so the API's 404 body does not change shape
  // between development (Vite serves the frontend, WEB_ROOT unset) and the
  // container (WEB_ROOT set). Frontend error handling written against one
  // would otherwise meet the other in the environment it was not tested in.
  app.setNotFoundHandler((request, reply) => {
    const notFound = () => reply.code(404).send(errorResponse('not_found'))
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
