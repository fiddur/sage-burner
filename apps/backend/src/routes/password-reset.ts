import type { MeResponse, ResetState } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import {
  apiRoutes,
  passwordResetRequestSchema,
  passwordResetSchema,
  RESET_VALID_HOURS,
  resetPage,
} from '@sage-burner/shared'
import { eq, lte } from 'drizzle-orm'

import type { Gate } from '../auth/gate.ts'
import type { Sessions } from '../auth/session.ts'
import type { Throttle } from '../auth/throttle.ts'
import type { Config } from '../config.ts'
import type { Database } from '../db/index.ts'
import type { MailDeps } from '../mail/mail.ts'
import type { EmailQueue } from '../mail/queue.ts'

import { hashPassword } from '../auth/password.ts'
import { resetExpiry, resetStatusOf } from '../auth/reset.ts'
import { viewerOf } from '../auth/viewer.ts'
import { account, passwordReset } from '../db/schema.ts'
import { bodyOf, noStore, sendError, sendThrottled } from '../http.ts'
import { installationTitle, mailSettingsFor, post } from '../mail/mail.ts'
import { resetMessage } from '../mail/messages.ts'
import { digestOf, mintToken } from '../tokens.ts'
import { cookieHeader } from './auth.ts'

export interface ResetLimits {
  byIp: Throttle
  byAddress: Throttle
}

export interface PasswordResetDeps {
  db: Database
  config: Config
  sessions: Sessions
  now: () => Date
  hash?: (password: string) => Promise<string>
  gate: Gate
  limits: ResetLimits
  mail: MailDeps
  defer: EmailQueue['defer']
}

export const registerPasswordResetRoutes = (
  app: FastifyInstance,
  { db, config, sessions, now, hash = hashPassword, gate, limits, mail, defer }: PasswordResetDeps,
) => {
  const heldFor = async (token: string) => {
    const [row] = await db
      .select({ account_id: passwordReset.account_id, expires_at: passwordReset.expires_at })
      .from(passwordReset)
      .where(eq(passwordReset.token_hash, digestOf(token)))
      .limit(1)

    return row
  }

  // `originOf` is deliberately not used here, unlike every other mail this app posts: this is
  // the one route where a stranger supplies the `Host` header, names the recipient and sets the
  // send off, so a shape-checked header would be a link to wherever they liked.
  const offerAReset = async (email: string) => {
    const origin = config.public_origin
    if (origin === undefined) {
      app.log.warn('a password reset was asked for, but PUBLIC_ORIGIN is not set')

      return
    }

    if ((await mailSettingsFor(db)) === undefined) return

    const [who] = await db
      .select({ id: account.id, email: account.email, name: account.name })
      .from(account)
      .where(eq(account.email, email))
      .limit(1)

    if (who === undefined) return

    const minted = mintToken()
    const at = now()

    db.transaction((tx) => {
      tx.delete(passwordReset).where(lte(passwordReset.expires_at, at.toISOString())).run()
      tx.delete(passwordReset).where(eq(passwordReset.account_id, who.id)).run()
      tx.insert(passwordReset)
        .values({
          token_hash: minted.token_hash,
          account_id: who.id,
          expires_at: resetExpiry(at),
          created_at: at.toISOString(),
        })
        .run()
    })

    const posted = await post(
      mail,
      resetMessage({
        installation: await installationTitle(db),
        to: who.email,
        name: who.name,
        link: `${origin}${resetPage(minted.token)}`,
        hours: RESET_VALID_HOURS,
      }),
    )

    if (!posted.sent) app.log.warn({ reason: posted.reason }, 'posting a password reset')
  }

  app.post(apiRoutes.requestPasswordReset.fastify, async (request, reply) => {
    void noStore(reply)

    const room = limits.byIp.take(request.ip)
    if (!room.ok) {
      request.log.warn({ status: 429 }, 'password resets throttled')

      return sendThrottled(reply, room.retryAfterSeconds)
    }

    const body = bodyOf(passwordResetRequestSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const attempt = limits.byAddress.take(body.email)
    if (!attempt.ok) return sendThrottled(reply, attempt.retryAfterSeconds)

    // Every read of the account is inside here, so the answer costs the same either way.
    defer(async () => {
      await offerAReset(body.email).catch((failure: unknown) => {
        request.log.error({ err: failure }, 'offering a password reset')
      })
    })

    return reply.code(204).send()
  })

  app.get<{ Params: { token: string } }>(apiRoutes.getPasswordResetState.fastify, async (request, reply) => {
    void noStore(reply)

    return { status: resetStatusOf(await heldFor(request.params.token), now()) } satisfies ResetState
  })

  app.post<{ Params: { token: string } }>(apiRoutes.resetPassword.fastify, async (request, reply) => {
    void noStore(reply)

    const room = limits.byIp.take(request.ip)
    if (!room.ok) return sendThrottled(reply, room.retryAfterSeconds)

    const body = bodyOf(passwordResetSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const held = await heldFor(request.params.token)
    if (held === undefined || resetStatusOf(held, now()) !== 'outstanding') return sendError(reply, 409)

    const admission = await gate.enter()
    if (!admission.ok) {
      void reply.header('retry-after', gate.retryAfter(admission.reason))
      request.log.warn({ ...gate.stats(), reason: admission.reason }, 'password reset shed')

      return sendError(reply, 429)
    }

    // `expires_at` is deliberately not re-checked below: the gap is a queue wait plus a hash.
    let password_hash: string
    try {
      password_hash = await hash(body.password)
    } finally {
      admission.release()
    }

    const spent = db.transaction((tx) => {
      const gone = tx
        .delete(passwordReset)
        .where(eq(passwordReset.token_hash, digestOf(request.params.token)))
        .returning({ account_id: passwordReset.account_id })
        .all()

      const [claimed] = gone
      if (claimed === undefined) return undefined

      tx.update(account).set({ password_hash }).where(eq(account.id, claimed.account_id)).run()

      return claimed.account_id
    })

    if (spent === undefined) return sendError(reply, 409)

    const viewer = await viewerOf(db, spent)
    if (viewer === undefined) return sendError(reply, 409)

    void reply.header('set-cookie', cookieHeader(sessions.issue(spent), config, config.session_ttl_seconds))

    return reply.code(200).send({ viewer } satisfies MeResponse)
  })
}
