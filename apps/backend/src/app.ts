import type { FastifyHelmetOptions } from '@fastify/helmet'
import type { FastifyInstance } from 'fastify'

import helmet from '@fastify/helmet'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import type { Gate } from './auth/gate.ts'
import type { GuardDeps } from './auth/guards.ts'
import type { Config } from './config.ts'
import type { Database } from './db/index.ts'
import type { Send } from './mail/mail.ts'
import type { EmailQueue } from './mail/queue.ts'
import type { OAuthCalls } from './oauth/client.ts'
import type { Delivery, VapidKeys } from './push/push.ts'

import { createGate, SCRYPT_GATE } from './auth/gate.ts'
import { createGuards } from './auth/guards.ts'
import { createSessions } from './auth/session.ts'
import { refuseEnvelopeStrippers } from './envelope.ts'
import { clientErrorHandler, frameworkErrorHandler, registerErrorHandler } from './errors.ts'
import { sendError } from './http.ts'
import { emailChannel } from './mail/channel.ts'
import { createEmailQueue, drainWithin } from './mail/queue.ts'
import { sendWithSmtp } from './mail/smtp.ts'
import { httpsOAuth } from './oauth/client.ts'
import { notifyAdmins, recordAndPush } from './push/notify.ts'
import { DEFAULT_PUSH_CONTACT, deliverWithWebPush, generateVAPIDKeys } from './push/web-push.ts'
import { registerAdminRoutes } from './routes/admin.ts'
import { registerAllergyRoutes } from './routes/allergies.ts'
import { registerApplicationReviewRoutes } from './routes/application-review.ts'
import { registerApplicationRoutes } from './routes/applications.ts'
import { registerAttendanceRoutes } from './routes/attendance.ts'
import { registerAuthRoutes } from './routes/auth.ts'
import { registerAvatarRoutes } from './routes/avatars.ts'
import { registerBannerRoutes } from './routes/banner.ts'
import { registerCalendarRoutes } from './routes/calendar.ts'
import { registerConnectionRoutes } from './routes/connections.ts'
import { readDocument, registerDocumentRoutes } from './routes/documents.ts'
import { registerEventOptionRoutes } from './routes/event-options.ts'
import { registerEventRoutes } from './routes/events.ts'
import { registerFaqRoutes } from './routes/faq.ts'
import { registerFeedRoutes } from './routes/feed.ts'
import { registerImageBodyParser } from './routes/image-body.ts'
import { registerImageRoutes } from './routes/images.ts'
import { registerInstallationRoutes } from './routes/installation.ts'
import { registerInviteRoutes } from './routes/invites.ts'
import { registerLeadRoleRoutes } from './routes/lead-roles.ts'
import { registerMailRoutes } from './routes/mail.ts'
import { registerMealAdminRoutes, registerMealRoutes } from './routes/meals.ts'
import { registerNotificationRoutes } from './routes/notifications.ts'
import { registerOauthAdminRoutes } from './routes/oauth-admin.ts'
import { registerOauthRoutes } from './routes/oauth.ts'
import { registerPasskeyRoutes } from './routes/passkeys.ts'
import { registerPeopleRoutes } from './routes/people.ts'
import { registerPlaceRoutes } from './routes/places.ts'
import { registerPostRoutes } from './routes/posts.ts'
import { registerProfileRoutes } from './routes/profile.ts'
import { registerPushRoutes } from './routes/push.ts'
import { registerPwaRoutes } from './routes/pwa.ts'
import { registerQuestionRoutes } from './routes/questions.ts'
import { registerRedemptionRoutes } from './routes/redemption.ts'
import { registerRideRoutes } from './routes/rides.ts'
import { registerRosterRoutes } from './routes/roster.ts'
import { registerScheduleRoutes } from './routes/schedule.ts'
import { registerSessionRoutes } from './routes/sessions.ts'
import { registerThreadRoutes } from './routes/threads.ts'
import { registerVersionRoutes } from './routes/version.ts'
import { createShellHandler, prepareShell } from './shell.ts'

export interface AppDeps {
  db: Database
  config: Config
  now?: () => Date
  hash?: (password: string) => Promise<string>
  deliver?: Delivery
  mintKeys?: () => VapidKeys
  send?: Send
  oauth?: OAuthCalls
  defer?: EmailQueue['defer']
  gate?: Gate
  changelog?: string
  privacy?: string
  terms?: string
  logStream?: { write: (chunk: string) => void }
}

const API_PREFIX = '/api'

const pathnameOf = (url: string) => {
  const [raw = url] = url.split('?')
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

const isApiRequest = (pathname: string) => pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`)

const looksLikeAsset = (pathname: string) => path.extname(pathname) !== ''

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

export const loggerOptions = (level: string) => ({
  level,
  redact: {
    paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]', 'err.headers'],
    remove: true,
  },
})

const helmetOptions = (): FastifyHelmetOptions => ({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'frame-ancestors': ["'none'"],

      'style-src': ["'self'"],
      'font-src': ["'self'"],

      'base-uri': ["'none'"],

      'img-src': ["'self'", 'data:', 'https:'],
    },
  },

  xFrameOptions: { action: 'deny' },
})

const sessionDeps = (config: Config) => ({
  secret: config.session_secret,
  now: () => new Date(),
  ttlSeconds: config.session_ttl_seconds,
})

const ADMIN_PREFIX = '/api/admin'

const registerAdminPrefixGuard = (app: FastifyInstance, deps: GuardDeps) => {
  const { requireAdmin } = createGuards(deps)

  app.addHook('onRequest', async (request, reply) => {
    const pattern = request.routeOptions.url
    if (pattern === undefined) return undefined
    if (pattern !== ADMIN_PREFIX && !pattern.startsWith(`${ADMIN_PREFIX}/`)) return undefined

    return requireAdmin(request, reply)
  })
}

export const createApp = async ({
  db,
  config,
  gate: suppliedGate,
  deliver = deliverWithWebPush(DEFAULT_PUSH_CONTACT),
  mintKeys = generateVAPIDKeys,
  send = sendWithSmtp,
  oauth = httpsOAuth,
  defer,
  hash,
  now = () => new Date(),
  logStream,
  changelog = readDocument('CHANGELOG.md'),
  privacy = readDocument('PRIVACY.md'),
  terms = readDocument('TERMS.md'),
}: AppDeps): Promise<FastifyInstance> => {
  const app = Fastify({
    logger: {
      ...loggerOptions(config.log_level),
      ...(logStream === undefined ? {} : { stream: logStream }),
    },
    trustProxy: config.trust_proxy,
    frameworkErrors: frameworkErrorHandler,
    clientErrorHandler,
  })

  await app.register(helmet, helmetOptions())

  app.removeContentTypeParser('text/plain')

  // Before any route that takes an image: Fastify throws on the second parser to claim a type.
  registerImageBodyParser(app)

  app.decorate('db', db)
  app.decorate('config', config)

  registerErrorHandler(app)
  // Before any route registers: `onRoute` only sees what comes after it.
  refuseEnvelopeStrippers(app)

  registerVersionRoutes(app, { config })
  registerDocumentRoutes(app, { changelog, privacy, terms })

  const sessions = createSessions(sessionDeps(config))

  const gate = suppliedGate ?? createGate(SCRYPT_GATE)

  registerAdminPrefixGuard(app, { db, sessions })

  const push = { db, deliver, now, mintKeys }

  const mail = { db, send }
  const byEmail = emailChannel({
    ...mail,
    ...(config.public_origin === undefined ? {} : { origin: config.public_origin }),
    log: (posted, account_id) =>
      app.log.warn({ reason: posted.reason, account_id }, 'posting a notification'),
  })

  const emails = createEmailQueue((failure: unknown) => {
    app.log.warn({ err: failure }, 'a queued notification email')
  })

  app.addHook('onClose', async () => await drainWithin(emails))

  const tellAccount = recordAndPush(
    push,
    now,
    (counts) => {
      app.log.warn({ ...counts }, 'notifying a member')
    },
    { post: byEmail, defer: defer ?? emails.defer },
  )

  registerAuthRoutes(app, { db, config, sessions, gate })
  registerPasskeyRoutes(app, { db, config, sessions, now })
  registerAdminRoutes(app, { db, hash })
  registerInstallationRoutes(app, { db })
  registerEventRoutes(app, { db, sessions, now })
  registerEventOptionRoutes(app, { db, sessions })
  registerQuestionRoutes(app, { db })
  registerPlaceRoutes(app, { db, sessions, now })
  registerRideRoutes(app, { db, sessions, now })
  registerAvatarRoutes(app, { db, sessions, now })
  registerImageRoutes(app, { db, sessions, now })
  registerConnectionRoutes(app, { db, sessions })
  registerPeopleRoutes(app, { db, sessions })
  registerOauthRoutes(app, { db, sessions, now, config, oauth })
  registerOauthAdminRoutes(app, { db, now })
  registerPwaRoutes(app, { db, sessions, now })
  registerBannerRoutes(app, { db, sessions, now })
  registerMailRoutes(app, { db, sessions, mail, now })
  registerMealRoutes(app, { db, sessions, now, notify: tellAccount })
  registerMealAdminRoutes(app, { db, sessions, now })

  registerPushRoutes(app, { db, sessions, push })
  registerNotificationRoutes(app, { db, sessions, now })

  registerApplicationRoutes(app, {
    db,
    now,
    notify: async (message) =>
      await notifyAdmins(db, tellAccount, {
        category: 'application',
        body: message,
        link: '/admin/applications',
      }),
  })
  registerApplicationReviewRoutes(app, { db, config, sessions, mail, now })
  registerInviteRoutes(app, { db, sessions, now })
  registerRedemptionRoutes(app, { db, config, sessions, now, hash, gate })
  registerAllergyRoutes(app, { db })
  registerAttendanceRoutes(app, { db, sessions, now, notify: tellAccount })
  registerPostRoutes(app, { db, sessions, now, notify: tellAccount })
  registerProfileRoutes(app, { db, sessions, now, notify: tellAccount })
  registerRosterRoutes(app, { db, sessions, now, notify: tellAccount })
  registerLeadRoleRoutes(app, { db, sessions, now, notify: tellAccount })
  registerFaqRoutes(app, { db, sessions, now })
  registerFeedRoutes(app, { db, sessions })
  registerSessionRoutes(app, { db, sessions, now, notify: tellAccount })
  registerThreadRoutes(app, { db, sessions, now, notify: tellAccount })
  registerScheduleRoutes(app, { db, now })
  registerCalendarRoutes(app, { db, sessions })

  const webRoot = config.web_root
  const servesWebApp = webRoot !== undefined
  let sendShell: ReturnType<typeof createShellHandler> | undefined

  if (webRoot !== undefined) {
    const root = path.resolve(webRoot)
    assertServableWebRoot(root)

    sendShell = createShellHandler({
      db,
      config,
      now,
      template: prepareShell(readFileSync(path.join(root, 'index.html'), 'utf8')),
    })

    app.get('/', sendShell)
    app.get('/index.html', sendShell)

    await app.register(fastifyStatic, {
      root,
      globIgnore: ['index.html'],
      wildcard: false,

      setHeaders: (response, filePath) => {
        const cacheable = path.relative(root, filePath).startsWith(`assets${path.sep}`)
        response.header('cache-control', cacheable ? 'public, max-age=31536000, immutable' : 'no-cache')
      },
    })
  }

  app.setNotFoundHandler((request, reply) => {
    const notFound = () => sendError(reply, 404)
    const pathname = pathnameOf(request.url)

    if (isApiRequest(pathname)) return notFound()

    if (!servesWebApp || sendShell === undefined) return notFound()

    if (request.method !== 'GET' && request.method !== 'HEAD') return notFound()

    if (looksLikeAsset(pathname)) return notFound()

    return sendShell(request, reply)
  })

  return app
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Database
    config: Config
  }
}
