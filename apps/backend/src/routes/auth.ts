import type { MeResponse } from '@sage-burner/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { apiRoutes, errorResponse, loginRequestSchema, signUpRequestSchema } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { Gate } from '../auth/gate.ts'
import type { Sessions } from '../auth/session.ts'
import type { Throttle } from '../auth/throttle.ts'
import type { Config } from '../config.ts'
import type { Database } from '../db/index.ts'

import { hashPassword, needsRehash, verifyPassword } from '../auth/password.ts'
import { SESSION_COOKIE, viewerFor, viewerOf } from '../auth/viewer.ts'
import { loginAddressConnection } from '../connections.ts'
import { isUniqueViolation } from '../db/errors.ts'
import { account, accountConnection } from '../db/schema.ts'
import { bodyOf, noStore, sendError, sendThrottled } from '../http.ts'

export const cookieHeader = (token: string, config: Config, maxAgeSeconds: number): string => {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (config.secure_cookies) parts.push('Secure')
  return parts.join('; ')
}

export interface LoginLimits {
  byIp: Throttle
  byAddress: Throttle
}

export interface AuthRouteDeps {
  now: () => Date
  db: Database
  config: Config
  sessions: Sessions
  gate: Gate
  limits: LoginLimits
}

export const registerAuthRoutes = (
  app: FastifyInstance,
  { db, config, sessions, gate, limits, now }: AuthRouteDeps,
) => {
  const handleLogin = async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = loginRequestSchema.safeParse(request.body)

    if (!parsed.success) {
      return reply.code(401).send(errorResponse('invalid_credentials'))
    }

    const attempt = limits.byAddress.take(parsed.data.email)
    if (!attempt.ok) return sendThrottled(reply, attempt.retryAfterSeconds)

    const [row] = await db
      .select({ id: account.id, password_hash: account.password_hash })
      .from(account)
      .where(eq(account.email, parsed.data.email))
      .limit(1)

    const stored = row?.password_hash ?? null
    const ok = await verifyPassword(parsed.data.password, stored, {
      onError: (error) => {
        request.log.error({ err: error }, 'password verification failed')
      },
    })

    if (!ok || row === undefined) {
      request.log.info({ status: 401 }, 'login rejected')
      return reply.code(401).send(errorResponse('invalid_credentials'))
    }

    if (stored !== null && needsRehash(stored)) {
      try {
        const upgraded = await hashPassword(parsed.data.password)
        await db.update(account).set({ password_hash: upgraded }).where(eq(account.id, row.id))
      } catch (error) {
        request.log.error({ err: error }, 'password rehash failed')
      }
    }

    const viewer = await viewerOf(db, row.id)
    if (viewer === undefined) return reply.code(401).send(errorResponse('invalid_credentials'))

    limits.byAddress.forget(parsed.data.email)

    void reply.header('set-cookie', cookieHeader(sessions.issue(row.id), config, config.session_ttl_seconds))

    return reply.code(200).send({ viewer } satisfies MeResponse)
  }

  app.post(apiRoutes.login.fastify, async (request, reply) => {
    void noStore(reply)

    const room = limits.byIp.take(request.ip)
    if (!room.ok) {
      request.log.warn({ status: 429 }, 'login throttled')

      return sendThrottled(reply, room.retryAfterSeconds)
    }

    const admission = await gate.enter()

    if (!admission.ok) {
      void reply.header('retry-after', gate.retryAfter(admission.reason))
      request.log.warn({ ...gate.stats(), reason: admission.reason }, 'login shed')
      return sendError(reply, 429)
    }

    try {
      return await handleLogin(request, reply)
    } finally {
      admission.release()
    }
  })

  app.post(apiRoutes.signUp.fastify, async (request, reply) => {
    void noStore(reply)

    const room = limits.byIp.take(request.ip)
    if (!room.ok) {
      request.log.warn({ status: 429 }, 'sign-up throttled')

      return sendThrottled(reply, room.retryAfterSeconds)
    }

    const body = bodyOf(signUpRequestSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const admission = await gate.enter()
    if (!admission.ok) {
      void reply.header('retry-after', gate.retryAfter(admission.reason))
      request.log.warn({ ...gate.stats(), reason: admission.reason }, 'sign-up shed')

      return sendError(reply, 429)
    }

    let password_hash: string
    try {
      password_hash = await hashPassword(body.password)
    } finally {
      admission.release()
    }

    const accountId = randomUUID()

    try {
      db.transaction((tx) => {
        tx.insert(account)
          .values({
            id: accountId,
            email: body.email,
            password_hash,
            name: body.name,
            created_at: now().toISOString(),
          })
          .run()

        tx.insert(accountConnection).values(loginAddressConnection(accountId, body.email)).run()
      })
    } catch (error) {
      // The same answer as an address already in use, because it is one: saying which would tell
      // a stranger whether somebody has an account here, and the membership is the private part.
      if (isUniqueViolation(error, 'account.email')) return sendError(reply, 409)
      throw error
    }

    void reply.header(
      'set-cookie',
      cookieHeader(sessions.issue(accountId), config, config.session_ttl_seconds),
    )

    return reply.code(201).send({
      viewer: { account_id: accountId, name: body.name, avatar: null, roles: [] },
    } satisfies MeResponse)
  })

  app.post(apiRoutes.logout.fastify, async (_request, reply: FastifyReply) => {
    void noStore(reply)
    void reply.header('set-cookie', cookieHeader('', config, 0))
    return reply.code(200).send({ viewer: null } satisfies MeResponse)
  })

  app.get(apiRoutes.getMe.fastify, async (request, reply) => {
    void noStore(reply)

    const viewer = (await viewerFor(request, { db, sessions })) ?? null
    return reply.code(200).send({ viewer } satisfies MeResponse)
  })
}
