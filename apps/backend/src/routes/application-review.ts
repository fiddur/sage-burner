import type { ApplicationDecisionResponse, ApplicationsResponse, InviteResponse } from '@sage-burner/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { errorResponse } from '@sage-burner/shared'
import { and, desc, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'

import { application, inviteToken } from '../db/schema.ts'
import { noStore } from '../http.ts'
import { defaultExpiry, mintToken } from '../invites.ts'
import { viewerFor } from './auth.ts'

export interface ApplicationReviewDeps extends GuardDeps {
  now?: () => Date
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
  { db, sessions, now = () => new Date() }: ApplicationReviewDeps,
) => {
  app.get('/api/admin/applications', async (_request, reply) => {
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
      if (viewer === undefined) return reply.code(401).send(errorResponse('unauthenticated'))

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
        // decided". Asked rather than inferred, the same way the question and
        // event PATCHes do it.
        const [existing] = await db.select().from(application).where(eq(application.id, id)).limit(1)

        return existing === undefined
          ? reply.code(404).send(errorResponse('not_found'))
          : reply.code(409).send(errorResponse('conflict'))
      }

      return {
        application: settled,
        invite: minted === undefined ? null : { token: minted.token, expires_at },
      } satisfies ApplicationDecisionResponse
    }

  app.post<{ Params: { id: string } }>('/api/admin/applications/:id/approve', settle('approved'))

  app.post<{ Params: { id: string } }>('/api/admin/applications/:id/reject', settle('rejected'))

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
  app.post<{ Params: { id: string } }>('/api/admin/applications/:id/invite', async (request, reply) => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return reply.code(401).send(errorResponse('unauthenticated'))

    const { id } = request.params
    const minted = mintToken()
    const expires_at = defaultExpiry(now())

    const outcome = db.transaction((tx) => {
      const [found] = tx.select().from(application).where(eq(application.id, id)).limit(1).all()
      if (found === undefined) return 'not_found' as const

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

    if (outcome === 'not_found') return reply.code(404).send(errorResponse('not_found'))
    if (outcome !== 'issued') return reply.code(409).send(errorResponse('conflict'))

    return { invite: { token: minted.token, expires_at } } satisfies InviteResponse
  })
}
