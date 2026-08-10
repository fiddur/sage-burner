import type { MeResponse } from '@sage-burner/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { apiRoutes, errorResponse, loginRequestSchema } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'

import type { Gate } from '../auth/gate.ts'
import type { Sessions } from '../auth/session.ts'
import type { Config } from '../config.ts'
import type { Database } from '../db/index.ts'

import { hashPassword, needsRehash, verifyPassword } from '../auth/password.ts'
import { SESSION_COOKIE, viewerFor, viewerOf } from '../auth/viewer.ts'
import { account } from '../db/schema.ts'
import { noStore, sendError } from '../http.ts'

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

export interface AuthRouteDeps {
  db: Database
  config: Config
  sessions: Sessions
  gate: Gate
}

export const registerAuthRoutes = (app: FastifyInstance, { db, config, sessions, gate }: AuthRouteDeps) => {
  const handleLogin = async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = loginRequestSchema.safeParse(request.body)

    if (!parsed.success) {
      return reply.code(401).send(errorResponse('invalid_credentials'))
    }

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

    void reply.header('set-cookie', cookieHeader(sessions.issue(row.id), config, config.session_ttl_seconds))

    return reply.code(200).send({ viewer } satisfies MeResponse)
  }

  app.post(apiRoutes.login.fastify, async (request, reply) => {
    void noStore(reply)

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
