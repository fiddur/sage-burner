import type { ApplicationDecisionResponse, ApplicationsResponse } from '@sage-burner/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { errorResponse } from '@sage-burner/shared'
import { and, desc, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'

import { createGuards } from '../auth/guards.ts'
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
  const { requireAdmin } = createGuards({ db, sessions })

  app.get('/api/admin/applications', { preHandler: requireAdmin }, async (_request, reply) => {
    void noStore(reply)

    const applications = await db.select().from(application).orderBy(desc(application.submitted_at))

    return { applications } satisfies ApplicationsResponse
  })

  const settle =
    (decision: 'approved' | 'rejected') =>
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      void noStore(reply)

      // Before the write, not after: `requireAdmin` has already resolved this,
      // and reading it afterwards meant a 401 branch that could only fire once
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

  app.post<{ Params: { id: string } }>(
    '/api/admin/applications/:id/approve',
    { preHandler: requireAdmin },
    settle('approved'),
  )

  app.post<{ Params: { id: string } }>(
    '/api/admin/applications/:id/reject',
    { preHandler: requireAdmin },
    settle('rejected'),
  )
}
