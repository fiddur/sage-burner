import type { InviteState, RedeemResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes, inviteStatusOf, redeemRequestSchema } from '@sage-burner/shared'
import { and, eq, isNull } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { Gate } from '../auth/gate.ts'
import type { Sessions } from '../auth/session.ts'
import type { Throttle } from '../auth/throttle.ts'
import type { Config } from '../config.ts'
import type { Database } from '../db/index.ts'
import type { Notifier } from '../push/notify.ts'

import { hashPassword } from '../auth/password.ts'
import { loginAddressConnection } from '../connections.ts'
import { isUniqueViolation } from '../db/errors.ts'
import {
  account,
  accountAllergy,
  accountConnection,
  accountRole,
  application,
  inviteRedemption,
  inviteToken,
} from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { digestOf, redemptionsOf } from '../invites.ts'
import { announceJoined, joinBurn } from './attendance.ts'
import { cookieHeader } from './auth.ts'

export interface RedemptionDeps {
  db: Database
  config: Config
  sessions: Sessions
  now: () => Date
  hash?: (password: string) => Promise<string>
  gate: Gate
  throttle: Throttle
  notify?: Notifier
}

const isEmailConflict = (error: unknown) => isUniqueViolation(error, 'account.email')

export const registerRedemptionRoutes = (
  app: FastifyInstance,
  {
    db,
    config,
    sessions,
    now,
    hash = hashPassword,
    gate,
    throttle,
    notify = async () => undefined,
  }: RedemptionDeps,
) => {
  app.get<{ Params: { token: string } }>(apiRoutes.getInviteState.fastify, async (request, reply) => {
    void noStore(reply)

    const [invite] = await db
      .select({
        id: inviteToken.id,
        expires_at: inviteToken.expires_at,
        used_at: inviteToken.used_at,
        revoked_at: inviteToken.revoked_at,
        max_uses: inviteToken.max_uses,
        applicant_name: application.applicant_name,
        applicant_email: application.applicant_email,
      })
      .from(inviteToken)
      .leftJoin(application, eq(application.id, inviteToken.application_id))
      .where(eq(inviteToken.token_hash, digestOf(request.params.token)))
      .limit(1)

    const status =
      invite === undefined
        ? 'unknown'
        : inviteStatusOf({ ...invite, redemptions: await redemptionsOf(db, invite.id) }, now())

    return {
      status,
      name: status === 'outstanding' ? (invite?.applicant_name ?? null) : null,
      email: status === 'outstanding' ? (invite?.applicant_email ?? null) : null,
    } satisfies InviteState
  })

  app.post<{ Params: { token: string } }>(apiRoutes.redeemInvite.fastify, async (request, reply) => {
    void noStore(reply)

    const room = throttle.take(request.ip)
    if (!room.ok) {
      void reply.header('retry-after', String(room.retryAfterSeconds))
      request.log.warn({ status: 429 }, 'redemption throttled')

      return sendError(reply, 429)
    }

    const body = bodyOf(redeemRequestSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const digest = digestOf(request.params.token)
    const [invite] = await db.select().from(inviteToken).where(eq(inviteToken.token_hash, digest)).limit(1)
    if (invite === undefined) return sendError(reply, 409)

    const already = await redemptionsOf(db, invite.id)
    if (inviteStatusOf({ ...invite, redemptions: already }, now()) !== 'outstanding') {
      return sendError(reply, 409)
    }

    const admission = await gate.enter()
    if (!admission.ok) {
      void reply.header('retry-after', gate.retryAfter(admission.reason))
      request.log.warn({ ...gate.stats(), reason: admission.reason }, 'redemption shed')
      return sendError(reply, 429)
    }

    // `expires_at` is deliberately not re-checked after this: the gap is a queue wait plus a
    // hash, and refusing somebody whose link was live when they pressed is the worse answer.
    let password_hash: string
    try {
      password_hash = await hash(body.password)
    } finally {
      admission.release()
    }

    const [taken] = await db
      .select({ id: account.id })
      .from(account)
      .where(eq(account.email, body.email))
      .limit(1)
    if (taken !== undefined) return sendError(reply, 409)
    const accountId = randomUUID()

    const claimed = ((): boolean => {
      try {
        return db.transaction((tx) => {
          // A group link is not claimed, only counted — the cap is checked above, once, before
          // the scrypt. Two arrivals in the same instant could take it one past its cap; that is
          // the size of window this app does not build machinery to close.
          if (invite.kind === 'single') {
            const stamped = tx
              .update(inviteToken)
              .set({ used_at: now().toISOString() })
              .where(and(eq(inviteToken.id, invite.id), isNull(inviteToken.used_at)))
              .returning({ id: inviteToken.id })
              .all()

            if (stamped.length !== 1) return false
          }

          tx.insert(account)
            .values({
              id: accountId,
              email: body.email,
              password_hash,
              name: body.name,
              contact: body.contact ?? body.email,
              allergies_notes: body.allergies_notes,
              invite_token_id: invite.kind === 'group' ? null : invite.id,
              created_at: now().toISOString(),
            })
            .run()

          if (invite.kind === 'group') {
            tx.insert(inviteRedemption)
              .values({
                id: randomUUID(),
                token_id: invite.id,
                account_id: accountId,
                redeemed_at: now().toISOString(),
              })
              .run()
          }

          for (const item_id of new Set(body.allergy_item_ids)) {
            tx.insert(accountAllergy).values({ account_id: accountId, item_id }).onConflictDoNothing().run()
          }

          tx.insert(accountRole).values({ account_id: accountId, role: 'member' }).run()

          tx.insert(accountConnection).values(loginAddressConnection(accountId, body.email)).run()

          return true
        })
      } catch (error) {
        if (isEmailConflict(error)) return false
        throw error
      }
    })()

    if (!claimed) return sendError(reply, 409)

    void reply.header(
      'set-cookie',
      cookieHeader(sessions.issue(accountId), config, config.session_ttl_seconds),
    )

    const wanted = body.join_event_id ?? undefined
    const joined =
      wanted === undefined
        ? undefined
        : await joinBurn(db, wanted, accountId, now).catch((failure: unknown) => {
            request.log.error({ err: failure, event_id: wanted }, 'redeemed but could not join')

            return undefined
          })

    if (joined?.created === true) {
      await announceJoined(db, notify, { stay: joined.stay, account_id: accountId }, now).catch(
        (failure: unknown) => {
          request.log.error({ err: failure }, 'joined but could not announce it')
        },
      )
    }

    return reply.code(201).send({
      viewer: {
        account_id: accountId,
        name: body.name,
        avatar: null,
        roles: ['member'],
      },
      attendance: joined?.stay ?? null,
    } satisfies RedeemResponse)
  })
}
