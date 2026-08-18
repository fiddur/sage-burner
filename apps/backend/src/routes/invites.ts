import type { AdminInvitesResponse, InviteRedemption, InviteResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes, groupInviteCreateSchema, inviteCreateSchema, inviteStatusOf } from '@sage-burner/shared'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'

import { viewerFor } from '../auth/viewer.ts'
import { whyNothingWritten } from '../db/refusals.ts'
import { account, application, inviteRedemption, inviteToken } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { defaultExpiry } from '../invites.ts'
import { mintToken } from '../tokens.ts'

export interface InviteRouteDeps extends GuardDeps {
  now: () => Date
}

export const registerInviteRoutes = (app: FastifyInstance, { db, sessions, now }: InviteRouteDeps) => {
  app.get(apiRoutes.getInvites.fastify, async (_request, reply) => {
    void noStore(reply)

    const rows = await db
      .select({
        id: inviteToken.id,
        kind: inviteToken.kind,
        application_id: inviteToken.application_id,
        applicant_name: application.applicant_name,
        label: inviteToken.label,
        expires_at: inviteToken.expires_at,
        used_at: inviteToken.used_at,
        revoked_at: inviteToken.revoked_at,
        max_uses: inviteToken.max_uses,
      })
      .from(inviteToken)
      .leftJoin(application, eq(application.id, inviteToken.application_id))
      .orderBy(desc(inviteToken.expires_at))

    const arrivals = await db
      .select({
        token_id: inviteRedemption.token_id,
        account_id: inviteRedemption.account_id,
        name: account.name,
        redeemed_at: inviteRedemption.redeemed_at,
      })
      .from(inviteRedemption)
      .innerJoin(account, eq(account.id, inviteRedemption.account_id))
      .orderBy(desc(inviteRedemption.redeemed_at))

    const byToken = new Map<string, InviteRedemption[]>()
    for (const { token_id, ...who } of arrivals) {
      byToken.set(token_id, [...(byToken.get(token_id) ?? []), who])
    }

    return {
      invites: rows.map((row) => {
        const redemptions = byToken.get(row.id) ?? []

        return {
          ...row,
          redemptions,
          status: inviteStatusOf({ ...row, redemptions: redemptions.length }, now()),
        }
      }),
    } satisfies AdminInvitesResponse
  })

  app.post(apiRoutes.createGroupInvite.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(groupInviteCreateSchema, request)
    if (body === undefined) return sendError(reply, 400)
    if (Date.parse(body.expires_at) <= now().getTime()) return sendError(reply, 400, 'expired')

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    const { token, token_hash } = mintToken()
    await db.insert(inviteToken).values({
      id: randomUUID(),
      token_hash,
      kind: 'group',
      label: body.label,
      max_uses: body.max_uses,
      application_id: null,
      expires_at: body.expires_at,
      used_at: null,
      created_by: viewer.account_id,
    })

    return reply
      .code(201)
      .send({ invite: { token, expires_at: body.expires_at }, delivery: null } satisfies InviteResponse)
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

    const closed = await db
      .update(inviteToken)
      .set({ revoked_at: now().toISOString() })
      .where(
        and(
          eq(inviteToken.id, request.params.id),
          eq(inviteToken.kind, 'group'),
          isNull(inviteToken.revoked_at),
        ),
      )
      .returning({ id: inviteToken.id })

    if (closed.length > 0) return reply.code(204).send()

    const deleted = await db
      .delete(inviteToken)
      .where(
        and(
          eq(inviteToken.id, request.params.id),
          eq(inviteToken.kind, 'single'),
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
