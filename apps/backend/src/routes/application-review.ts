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
import { application, INSTALLATION_ID, installation, inviteToken } from '../db/schema.ts'
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

/**
 * Reviewing what people have sent in.
 *
 * Approving and rejecting are the same shape: settle the application with a
 * conditional `UPDATE ... WHERE status = 'pending'`, and treat zero affected
 * rows as "someone else already decided this". That is what makes a
 * double-clicked Approve mint one invite rather than two — the decision and the
 * guard against re-deciding are the same statement, so there is no window
 * between them.
 */
export const registerApplicationReviewRoutes = (
  app: FastifyInstance,
  { db, sessions, mail, config, now }: ApplicationReviewDeps,
) => {
  /**
   * The invite, in the applicant's inbox, if that is what they gave us (#30).
   *
   * `applicant_email` is an address for everybody who has applied since #30, and
   * whatever the old free-text box held for everybody before — see `looksLikeEmail`,
   * which is what decides. Nothing changes for the others: the raw token is in the
   * response either way, and pasting it into Discord is how this worked before there
   * was a mail server to configure.
   *
   * **The answer goes back to the admin** (#327), which is the whole of what was wrong
   * here: the outcome went to the log and the page said "Send this link" whichever way
   * it had gone. Both directions were wrong — a link sent twice by two people, or a
   * send that failed on a TLS misconfiguration and nobody the wiser. `null` is nothing
   * attempted, which needs different words from a refusal.
   *
   * Awaited, and never throws: `post` answers with the reason instead, and a
   * refusal is logged rather than turned into a failed approval. Bounded by the
   * client's own timeouts, so an unreachable server cannot hang the request.
   */
  const postInvite = async (
    request: FastifyRequest,
    settled: { applicant_email: string; applicant_name: string },
    token: string,
    expires_at: string,
  ): Promise<InviteDelivery> => {
    if (!looksLikeEmail(settled.applicant_email)) return null

    const origin = originOf(request, config)
    // Nothing to put in the message: the link has to be absolute to be clickable in an
    // inbox, and this installation cannot say where it lives. A reason rather than
    // silence — it is the admin's to fix, in `PUBLIC_ORIGIN`.
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

      // Before the write, not after: the admin prefix guard has already resolved
      // this, and reading it afterwards meant a 401 branch that could only fire once
      // the decision had committed — leaving exactly the orphan state the
      // transaction below exists to prevent.
      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      const { id } = request.params
      const minted = decision === 'approved' ? mintToken() : undefined
      const expires_at = defaultExpiry(now())

      // One transaction, because approving is two writes and half of it is
      // worse than neither: an application left `approved` with no invite cannot
      // be recovered through the API — re-approving matches nothing on
      // `status = 'pending'`, and the partial unique index refuses a second
      // invite for the same application. The driver is synchronous, so this is
      // the same shape `questions.ts` uses to assign `order`.
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
        // Nothing was written, which is either "no such application" or "already
        // decided" — see `whyNothingWritten`.
        const why = await whyNothingWritten(db, application, eq(application.id, id))

        return sendError(reply, why === 'not_found' ? 404 : 409)
      }

      // After the transaction, and never inside it: the invite is committed by the
      // time this runs, so a mail server that is down costs a message rather than an
      // approval. The link the admin sees is still the one that matters, and it is
      // shown whether or not the message got out — a bounce is invisible to this app.
      // What the outcome changes is only the words beside it (#327).
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

  /**
   * A fresh link for an application whose first one was lost.
   *
   * The raw token exists in the approval's response and nowhere else — only the
   * digest is stored — and the link is shown in a paragraph that vanishes on
   * reload, so losing it before pasting it into Discord is a realistic accident.
   * Until this route there was no way back: re-approving matches nothing on
   * `status = 'pending'`, and the partial unique index refuses a second invite for
   * the same application.
   *
   * **The row is updated, not replaced.** One row per application stays the
   * invariant the index already enforces, and rewriting `token_hash` is what
   * invalidates the old link — the lost token no longer hashes to anything stored,
   * in the same statement that mints its replacement. That is what closes #137: the
   * documented workaround was to mint a *direct* invite instead, which left the
   * application's own invite live, so a lost link turning up later redeemed into a
   * second, unrelated account for the same person.
   *
   * Refused once the invite has been used. By then they are already in, and a fresh
   * link would be a second account by another name — the same hole from the other
   * end.
   */
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

      // Only an approved application has anybody to invite. A pending one is
      // approved instead, and a rejected one is not reopened by a side door.
      if (found.status !== 'approved') return 'not_approved' as const

      const [existing] = tx
        .select()
        .from(inviteToken)
        .where(eq(inviteToken.application_id, id))
        .limit(1)
        .all()

      if (existing?.used_at != null) return 'already_used' as const

      if (existing === undefined) {
        // No row at all. Not reachable through the API today — approving always
        // mints one and the delete route refuses an application's invite — but
        // this route's job is "make sure this approved application has one live
        // link", and answering 404 because a hand-edited database lost the row
        // would leave the one case it exists for unrecoverable.
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
    // `errorResponse` rather than `sendError`, which pairs one slug with each status:
    // both of these are 409 and they mean opposite things to whoever is reading the
    // page, so the page needs to tell them apart (#178).
    if (outcome !== 'issued') {
      return reply.code(409).send(errorResponse(outcome === 'not_approved' ? 'not_approved' : 'invite_used'))
    }

    // Posted here as well as on approval, which is the case this route exists for: a
    // link that was lost. An address that has not changed gets the new one where the
    // first went, and the admin still has it in the response either way.
    const delivery =
      applicant === undefined ? null : await postInvite(request, applicant, minted.token, expires_at)

    return { invite: { token: minted.token, expires_at }, delivery } satisfies InviteResponse
  })
}
