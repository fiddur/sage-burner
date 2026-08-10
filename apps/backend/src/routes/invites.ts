import type { AdminInvitesResponse, InviteResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes, inviteCreateSchema, inviteStatusOf } from '@sage-burner/shared'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'

import { viewerFor } from '../auth/viewer.ts'
import { whyNothingWritten } from '../db/refusals.ts'
import { application, inviteToken } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { defaultExpiry, mintToken } from '../invites.ts'

export interface InviteRouteDeps extends GuardDeps {
  now: () => Date
}

export const registerInviteRoutes = (app: FastifyInstance, { db, sessions, now }: InviteRouteDeps) => {
  app.get(apiRoutes.getInvites.fastify, async (_request, reply) => {
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

  app.post(apiRoutes.createInvite.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(inviteCreateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const expires_at = body.expires_at ?? defaultExpiry(now())
    if (Date.parse(expires_at) <= now().getTime()) {
      return sendError(reply, 400)
    }

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    const { token, token_hash } = mintToken()
    await db.insert(inviteToken).values({
      id: randomUUID(),
      token_hash,
      application_id: null,
      expires_at,
      used_at: null,
      created_by: viewer.account_id,
    })

    return reply.code(201).send({ invite: { token, expires_at }, delivery: null } satisfies InviteResponse)
  })

  app.delete<{ Params: { id: string } }>(apiRoutes.revokeInvite.fastify, async (request, reply) => {
    void noStore(reply)

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

    const why = await whyNothingWritten(db, inviteToken, eq(inviteToken.id, request.params.id))

    return sendError(reply, why === 'not_found' ? 404 : 409)
  })
}
