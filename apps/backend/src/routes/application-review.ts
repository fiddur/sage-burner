import type { ApplicationDecisionResponse, ApplicationsResponse } from '@sage-burner/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { errorResponse } from '@sage-burner/shared'
import { and, desc, eq } from 'drizzle-orm'
import { createHash, randomBytes, randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'

import { createGuards } from '../auth/guards.ts'
import { application, inviteToken } from '../db/schema.ts'
import { noStore } from '../http.ts'
import { viewerFor } from './auth.ts'

export interface ApplicationReviewDeps extends GuardDeps {
  now?: () => Date
}

const INVITE_TOKEN_BYTES = 32
const INVITE_VALID_DAYS = 30

/**
 * A token that has to be unguessable, and a digest that is all we keep.
 *
 * 32 CSPRNG bytes, base64url so it survives a URL untouched. Only the SHA-256
 * goes to the database, so a leaked backup hands out no invites — and the raw
 * value exists in exactly one response and nowhere else.
 */
const mintToken = () => {
  const token = randomBytes(INVITE_TOKEN_BYTES).toString('base64url')

  return { token, token_hash: createHash('sha256').update(token).digest('hex') }
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

      const { id } = request.params
      const decided = await db
        .update(application)
        .set({ status: decision, decided_at: now().toISOString() })
        .where(and(eq(application.id, id), eq(application.status, 'pending')))
        .returning()

      const [settled] = decided
      if (settled === undefined) {
        // Nothing was written, which is either "no such application" or "already
        // decided". Asked rather than inferred, the same way the question and
        // event PATCHes do it.
        const [existing] = await db.select().from(application).where(eq(application.id, id)).limit(1)

        return existing === undefined
          ? reply.code(404).send(errorResponse('not_found'))
          : reply.code(409).send(errorResponse('conflict'))
      }

      if (decision === 'rejected') {
        return { application: settled, invite: null } satisfies ApplicationDecisionResponse
      }

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return reply.code(401).send(errorResponse('unauthenticated'))

      const { token, token_hash } = mintToken()
      const expires_at = new Date(now().getTime() + INVITE_VALID_DAYS * 24 * 60 * 60 * 1000).toISOString()

      await db.insert(inviteToken).values({
        id: randomUUID(),
        token_hash,
        application_id: settled.id,
        expires_at,
        used_at: null,
        created_by: viewer.account_id,
      })

      return {
        application: settled,
        invite: { token, expires_at },
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
