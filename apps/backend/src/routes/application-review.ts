import type {
  ApplicantIdentity,
  ApplicationDecisionResponse,
  ApplicationMessagesResponse,
  ApplicationsResponse,
  InviteDelivery,
  InviteResponse,
} from '@sage-burner/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { apiRoutes, applicationMessageInputSchema, errorResponse, looksLikeEmail } from '@sage-burner/shared'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Config } from '../config.ts'
import type { MailDeps } from '../mail/mail.ts'
import type { Notifier } from '../push/notify.ts'

import { viewerFor } from '../auth/viewer.ts'
import { whyNothingWritten } from '../db/refusals.ts'
import {
  account,
  accountIdentity,
  accountRole,
  application,
  installation,
  INSTALLATION_ID,
  inviteToken,
} from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { defaultExpiry, mintToken } from '../invites.ts'
import { NO_ORIGIN, post } from '../mail/mail.ts'
import { decisionMessage, inviteMessage } from '../mail/messages.ts'
import { originOf } from '../shell.ts'
import { messagesOn, sayOnApplication } from './applications.ts'
import { announceJoined, joinBurn } from './attendance.ts'
import { activeEventNow } from './events.ts'

export interface ApplicationReviewDeps extends GuardDeps {
  config: Config
  mail: MailDeps
  now: () => Date
  notify?: Notifier
}

export const registerApplicationReviewRoutes = (
  app: FastifyInstance,
  { db, sessions, mail, config, now, notify = async () => undefined }: ApplicationReviewDeps,
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

  /**
   * Applying means wanting to come, so approval puts them on the list for the next burn — the
   * same `joinBurn` redeeming an invite used, and the same card and bell every other arrival
   * gets. A burn nobody has planned yet is not a failure: the member joins from the page.
   */
  const joinTheNextBurn = async (accountId: string) => {
    const next = await activeEventNow(db, now)
    if (next === undefined) return

    const joined = await joinBurn(db, next.id, accountId, now).catch((failure: unknown) => {
      app.log.error({ err: failure, event_id: next.id }, 'approved but could not join')

      return undefined
    })

    if (joined?.created !== true) return

    await announceJoined(db, notify, { stay: joined.stay, account_id: accountId }, now).catch(
      (failure: unknown) => {
        app.log.error({ err: failure }, 'joined but could not announce it')
      },
    )
  }

  /**
   * The bell, and a message to the address they gave. Direct rather than through the notification
   * email column, which is off until somebody asks (#30): this is the mail the invite email used
   * to be — about the account itself — and a rejection heard by nobody is a door closing in
   * silence.
   */
  const tellApplicant = async (
    request: FastifyRequest,
    settled: { account_id: string | null; applicant_name: string; applicant_email: string },
    approved: boolean,
  ) => {
    const { account_id } = settled
    if (account_id === null) return

    await notify(account_id, {
      category: 'application_news',
      body: approved ? 'You are in. Welcome!' : 'Your application has been answered.',
      link: approved ? '/' : '/apply',
    }).catch((failure: unknown) => {
      app.log.error({ err: failure }, 'telling an applicant of the decision')
    })

    if (!looksLikeEmail(settled.applicant_email)) return

    const origin = originOf(request, config)
    if (origin === undefined) return

    const [named] = await db
      .select({ title: installation.title })
      .from(installation)
      .where(eq(installation.id, INSTALLATION_ID))
      .limit(1)

    const posted = await post(
      mail,
      decisionMessage({
        installation: named?.title ?? '',
        to: settled.applicant_email,
        name: settled.applicant_name,
        approved,
        link: `${origin}${approved ? '/' : '/apply'}`,
      }),
    )

    if (!posted.sent) app.log.warn({ reason: posted.reason }, 'posting a decision')
  }

  app.get(apiRoutes.getApplications.fastify, async (_request, reply) => {
    void noStore(reply)

    const rows = await db.select().from(application).orderBy(desc(application.submitted_at))

    const applicants = rows.flatMap((row) => (row.account_id === null ? [] : [row.account_id]))
    const identities =
      applicants.length === 0
        ? []
        : await db
            .select({
              account_id: accountIdentity.account_id,
              provider: accountIdentity.provider,
              name: account.name,
              profile_url: accountIdentity.profile_url,
            })
            .from(accountIdentity)
            .innerJoin(account, eq(account.id, accountIdentity.account_id))
            .where(inArray(accountIdentity.account_id, applicants))

    const byAccount = new Map<string, ApplicantIdentity[]>()
    for (const { account_id, ...identity } of identities) {
      byAccount.set(account_id, [...(byAccount.get(account_id) ?? []), identity])
    }

    const applications = rows.map((row) => ({
      ...row,
      identities: row.account_id === null ? [] : (byAccount.get(row.account_id) ?? []),
    }))

    return { applications } satisfies ApplicationsResponse
  })

  const settle =
    (decision: 'approved' | 'rejected') =>
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      void noStore(reply)

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      const { id } = request.params
      const [held] = await db.select().from(application).where(eq(application.id, id)).limit(1)

      // Only an application from before #476 has no account, and only those still want a token —
      // approving one of those is the old flow, unchanged, because the link is all it can offer.
      const legacy = held !== undefined && held.account_id === null
      const minted = decision === 'approved' && legacy ? mintToken() : undefined
      const expires_at = defaultExpiry(now())

      const settled = db.transaction((tx) => {
        const [row] = tx
          .update(application)
          .set({ status: decision, decided_at: now().toISOString() })
          .where(and(eq(application.id, id), eq(application.status, 'pending')))
          .returning()
          .all()

        if (row === undefined) return row

        if (row.account_id !== null && decision === 'approved') {
          tx.insert(accountRole)
            .values({ account_id: row.account_id, role: 'member' })
            .onConflictDoNothing()
            .run()
        }

        if (minted === undefined) return row

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

      if (settled.account_id !== null && decision === 'approved') await joinTheNextBurn(settled.account_id)
      if (settled.account_id !== null) await tellApplicant(request, settled, decision === 'approved')

      const delivery =
        minted === undefined ? null : await postInvite(request, settled, minted.token, expires_at)

      return {
        application: settled,
        invite: minted === undefined ? null : { token: minted.token, expires_at },
        delivery,
      } satisfies ApplicationDecisionResponse
    }

  app.get<{ Params: { id: string } }>(apiRoutes.getApplicationMessages.fastify, async (request, reply) => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    return { messages: await messagesOn(db, request.params.id, viewer) } satisfies ApplicationMessagesResponse
  })

  app.post<{ Params: { id: string } }>(apiRoutes.sendApplicationMessage.fastify, async (request, reply) => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    const body = bodyOf(applicationMessageInputSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const [found] = await db
      .select({ id: application.id, account_id: application.account_id })
      .from(application)
      .where(eq(application.id, request.params.id))
      .limit(1)

    if (found === undefined) return sendError(reply, 404)

    await sayOnApplication(db, found.id, viewer.account_id, body.body, now())

    if (found.account_id !== null) {
      await notify(found.account_id, {
        category: 'application_news',
        body: 'The organisers replied to your application.',
        link: '/apply',
      }).catch((failure: unknown) => {
        request.log.error({ err: failure }, 'telling an applicant of a reply')
      })
    }

    return { messages: await messagesOn(db, found.id, viewer) } satisfies ApplicationMessagesResponse
  })

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
      // Approving an account-first application grants the role outright (#476), so a token here
      // would be a second account for somebody who already has one.
      if (found.account_id !== null) return 'already_used' as const

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
