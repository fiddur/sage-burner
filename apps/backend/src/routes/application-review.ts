import type {
  ApplicationDecisionResponse,
  ApplicationsResponse,
  InviteDelivery,
  InviteResponse,
} from '@sage-burner/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { apiRoutes, errorResponse, looksLikeEmail } from '@sage-burner/shared'
import { and, desc, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Config } from '../config.ts'
import type { MailDeps } from '../mail/mail.ts'

import { viewerFor } from '../auth/viewer.ts'
import { whyNothingWritten } from '../db/refusals.ts'
import { application, installation, INSTALLATION_ID, inviteToken } from '../db/schema.ts'
import { noStore, sendError } from '../http.ts'
import { defaultExpiry, mintToken } from '../invites.ts'
import { NO_ORIGIN, post } from '../mail/mail.ts'
import { inviteMessage } from '../mail/messages.ts'
import { originOf } from '../shell.ts'

export interface ApplicationReviewDeps extends GuardDeps {
  config: Config
  mail: MailDeps
  now: () => Date
}

export const registerApplicationReviewRoutes = (
  app: FastifyInstance,
  { db, sessions, mail, config, now }: ApplicationReviewDeps,
) => {
  const postInvite = async (
    request: FastifyRequest,
    settled: { applicant_email: string; applicant_name: string },
    token: string,
    expires_at: string,
  ): Promise<InviteDelivery> => {
    if (!looksLikeEmail(settled.applicant_email)) return null

    const origin = originOf(request, config)
    if (origin === undefined) {
      return { sent: false, to: settled.applicant_email, reason: NO_ORIGIN }
    }

    const [named] = await db
      .select({ title: installation.title })
      .from(installation)
      .where(eq(installation.id, INSTALLATION_ID))
      .limit(1)

    const posted = await post(
      mail,
      inviteMessage({
        installation: named?.title ?? '',
        to: settled.applicant_email,
        name: settled.applicant_name,
        link: `${origin}/invite/${token}`,
        expires: expires_at.slice(0, 10),
      }),
    )

    if (!posted.sent) app.log.warn({ reason: posted.reason }, 'posting an invite')

    return { ...posted, to: settled.applicant_email }
  }

  app.get(apiRoutes.getApplications.fastify, async (_request, reply) => {
    void noStore(reply)

    const applications = await db.select().from(application).orderBy(desc(application.submitted_at))

    return { applications } satisfies ApplicationsResponse
  })

  const settle =
    (decision: 'approved' | 'rejected') =>
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      void noStore(reply)

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      const { id } = request.params
      const minted = decision === 'approved' ? mintToken() : undefined
      const expires_at = defaultExpiry(now())

      const settled = db.transaction((tx) => {
        const [row] = tx
          .update(application)
          .set({ status: decision, decided_at: now().toISOString() })
          .where(and(eq(application.id, id), eq(application.status, 'pending')))
          .returning()
          .all()

        if (row === undefined || minted === undefined) return row

        tx.insert(inviteToken)
          .values({
            id: randomUUID(),
            token_hash: minted.token_hash,
            application_id: row.id,
            expires_at,
            used_at: null,
            created_by: viewer.account_id,
          })
          .run()

        return row
      })

      if (settled === undefined) {
        const why = await whyNothingWritten(db, application, eq(application.id, id))

        return sendError(reply, why === 'not_found' ? 404 : 409)
      }

      const delivery =
        minted === undefined ? null : await postInvite(request, settled, minted.token, expires_at)

      return {
        application: settled,
        invite: minted === undefined ? null : { token: minted.token, expires_at },
        delivery,
      } satisfies ApplicationDecisionResponse
    }

  app.post<{ Params: { id: string } }>(apiRoutes.approveApplication.fastify, settle('approved'))

  app.post<{ Params: { id: string } }>(apiRoutes.rejectApplication.fastify, settle('rejected'))

  app.post<{ Params: { id: string } }>(apiRoutes.reissueInvite.fastify, async (request, reply) => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    const { id } = request.params
    const minted = mintToken()
    const expires_at = defaultExpiry(now())

    let applicant: { applicant_email: string; applicant_name: string } | undefined
    const outcome = db.transaction((tx) => {
      const [found] = tx.select().from(application).where(eq(application.id, id)).limit(1).all()
      if (found === undefined) return 'not_found' as const
      applicant = found

      if (found.status !== 'approved') return 'not_approved' as const

      const [existing] = tx
        .select()
        .from(inviteToken)
        .where(eq(inviteToken.application_id, id))
        .limit(1)
        .all()

      if (existing?.used_at != null) return 'already_used' as const

      if (existing === undefined) {
        tx.insert(inviteToken)
          .values({
            id: randomUUID(),
            token_hash: minted.token_hash,
            application_id: id,
            expires_at,
            used_at: null,
            created_by: viewer.account_id,
          })
          .run()

        return 'issued' as const
      }

      tx.update(inviteToken)
        .set({ token_hash: minted.token_hash, expires_at, created_by: viewer.account_id })
        .where(eq(inviteToken.id, existing.id))
        .run()

      return 'issued' as const
    })

    if (outcome === 'not_found') return sendError(reply, 404)
    if (outcome !== 'issued') {
      return reply.code(409).send(errorResponse(outcome === 'not_approved' ? 'not_approved' : 'invite_used'))
    }

    const delivery =
      applicant === undefined ? null : await postInvite(request, applicant, minted.token, expires_at)

    return { invite: { token: minted.token, expires_at }, delivery } satisfies InviteResponse
  })
}
