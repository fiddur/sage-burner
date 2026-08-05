import type { AdminInvitesResponse, InviteResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { errorResponse, inviteCreateSchema, inviteStatusOf } from '@sage-burner/shared'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'

import { viewerFor } from '../auth/viewer.ts'
import { application, inviteToken } from '../db/schema.ts'
import { noStore } from '../http.ts'
import { defaultExpiry, mintToken } from '../invites.ts'

export interface InviteRouteDeps extends GuardDeps {
  now?: () => Date
}

/**
 * Invites an organiser mints directly, for people already known — returning
 * members, partners — who should skip the form.
 *
 * The same token shape approval mints, so both redeem through one path: CSPRNG
 * bytes, digest stored, raw value returned once.
 */
export const registerInviteRoutes = (
  app: FastifyInstance,
  { db, sessions, now = () => new Date() }: InviteRouteDeps,
) => {
  app.get('/api/admin/invites', async (_request, reply) => {
    void noStore(reply)

    const rows = await db
      .select({
        id: inviteToken.id,
        application_id: inviteToken.application_id,
        applicant_name: application.applicant_name,
        expires_at: inviteToken.expires_at,
        used_at: inviteToken.used_at,
      })
      .from(inviteToken)
      .leftJoin(application, eq(application.id, inviteToken.application_id))
      .orderBy(desc(inviteToken.expires_at))

    return {
      invites: rows.map((row) => ({ ...row, status: inviteStatusOf(row, now()) })),
    } satisfies AdminInvitesResponse
  })

  app.post('/api/admin/invites', async (request, reply) => {
    void noStore(reply)

    const parsed = inviteCreateSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

    const expires_at = parsed.data.expires_at ?? defaultExpiry(now())
    // An invite that is already dead is a link an organiser would send and
    // nobody could use, so it is refused rather than stored.
    if (Date.parse(expires_at) <= now().getTime()) {
      return reply.code(400).send(errorResponse('bad_request'))
    }

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return reply.code(401).send(errorResponse('unauthenticated'))

    const { token, token_hash } = mintToken()
    await db.insert(inviteToken).values({
      id: randomUUID(),
      token_hash,
      application_id: null,
      expires_at,
      used_at: null,
      created_by: viewer.account_id,
    })

    return reply.code(201).send({ invite: { token, expires_at } } satisfies InviteResponse)
  })

  app.delete<{ Params: { id: string } }>('/api/admin/invites/:id', async (request, reply) => {
    void noStore(reply)

    // Only an unredeemed direct invite. A redeemed one is the record of how
    // someone got in and `account` references it; an application's invite is the
    // only one that application will ever have, so deleting it would leave that
    // applicant with nothing to redeem. A direct invite still gets them in; what
    // cannot be recovered is the tie back to what they wrote, which is what #91
    // would restore by re-issuing against the application.
    const deleted = await db
      .delete(inviteToken)
      .where(
        and(
          eq(inviteToken.id, request.params.id),
          isNull(inviteToken.used_at),
          isNull(inviteToken.application_id),
        ),
      )
      .returning({ id: inviteToken.id })

    if (deleted.length > 0) return reply.code(204).send()

    const [existing] = await db
      .select()
      .from(inviteToken)
      .where(eq(inviteToken.id, request.params.id))
      .limit(1)

    return existing === undefined
      ? reply.code(404).send(errorResponse('not_found'))
      : reply.code(409).send(errorResponse('conflict'))
  })
}
