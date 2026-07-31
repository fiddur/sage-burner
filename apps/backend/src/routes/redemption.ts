import type { InviteState } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { errorResponse, inviteStatusOf, redeemRequestSchema } from '@sage-burner/shared'
import { and, eq, isNull } from 'drizzle-orm'
import { createHash, randomUUID } from 'node:crypto'

import type { Sessions } from '../auth/session.ts'
import type { Config } from '../config.ts'
import type { Database } from '../db/index.ts'

import { hashPassword } from '../auth/password.ts'
import { account, accountRole, inviteToken } from '../db/schema.ts'
import { noStore } from '../http.ts'
import { cookieHeader } from './auth.ts'

export interface RedemptionDeps {
  db: Database
  config: Config
  sessions: Sessions
  now?: () => Date
}

const digestOf = (token: string) => createHash('sha256').update(token).digest('hex')

/** Mirrors `isSlugConflict` in `events.ts`: a lost UNIQUE race is a 409, not a 500. */
const isEmailConflict = (error: unknown) =>
  error instanceof Error && /UNIQUE constraint failed: account\.email/i.test(error.message)

/**
 * Turning an invite link into an account.
 *
 * Unauthenticated, and the token is the only credential — an invite is
 * unguessable but forwardable, so whoever holds it is a stranger until they
 * redeem. Nothing here names who the invite was minted for.
 */
export const registerRedemptionRoutes = (
  app: FastifyInstance,
  { db, config, sessions, now = () => new Date() }: RedemptionDeps,
) => {
  app.get<{ Params: { token: string } }>('/api/invites/:token', async (request, reply) => {
    void noStore(reply)

    const [invite] = await db
      .select({ expires_at: inviteToken.expires_at, used_at: inviteToken.used_at })
      .from(inviteToken)
      .where(eq(inviteToken.token_hash, digestOf(request.params.token)))
      .limit(1)

    // 200 with a status either way, and the same shape for all four: a 404 for an
    // unknown token, or a different body, would let someone probe for live ones.
    // The page needs to tell an expired invite from a spent one, which is the
    // whole reason this is not just an error code.
    return {
      status: invite === undefined ? 'unknown' : inviteStatusOf(invite, now()),
    } satisfies InviteState
  })

  app.post<{ Params: { token: string } }>('/api/invites/:token/redeem', async (request, reply) => {
    void noStore(reply)

    const parsed = redeemRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

    const digest = digestOf(request.params.token)
    const [invite] = await db.select().from(inviteToken).where(eq(inviteToken.token_hash, digest)).limit(1)

    if (invite === undefined) return reply.code(404).send(errorResponse('not_found'))
    if (inviteStatusOf(invite, now()) !== 'outstanding') {
      return reply.code(409).send(errorResponse('conflict'))
    }

    // Checked before the write so the token is not spent on a request that cannot
    // finish: an account whose email is taken has nothing to retry with, and the
    // invite would already be gone. The insert's UNIQUE is still the authority —
    // this only decides which error the caller sees.
    const [taken] = await db
      .select({ id: account.id })
      .from(account)
      .where(eq(account.email, parsed.data.email))
      .limit(1)
    if (taken !== undefined) return reply.code(409).send(errorResponse('conflict'))

    // Hashed outside the transaction: scrypt costs ~230ms, and holding a write
    // transaction open across it would block every other writer for that long.
    const password_hash = await hashPassword(parsed.data.password)
    const accountId = randomUUID()

    // One transaction for the account, its role and the stamp. Half a redemption
    // is the worst outcome — a spent token with no account behind it leaves the
    // person no way to finish and nobody a way to re-issue (#91).
    //
    // The stamp is conditional on `used_at IS NULL` and requires one affected row,
    // so two concurrent redemptions of one token cannot both proceed: the loser's
    // UPDATE matches nothing and the whole transaction rolls back.
    // The pre-check above is not enough on its own: two requests can both pass it
    // before either writes. The UNIQUE is the authority, and losing to it is a
    // conflict rather than an internal error — the same distinction `events.ts`
    // draws for a slug.
    const claimed = ((): boolean => {
      try {
        return db.transaction((tx) => {
          const stamped = tx
            .update(inviteToken)
            .set({ used_at: now().toISOString() })
            .where(and(eq(inviteToken.id, invite.id), isNull(inviteToken.used_at)))
            .returning({ id: inviteToken.id })
            .all()

          if (stamped.length !== 1) return false

          tx.insert(account)
            .values({
              id: accountId,
              email: parsed.data.email,
              password_hash,
              name: parsed.data.name,
              contact: parsed.data.contact,
              allergies_notes: parsed.data.allergies_notes,
              invite_token_id: invite.id,
              created_at: now().toISOString(),
            })
            .run()

          // Redeeming an invite is what makes someone a member. No attendance row:
          // coming to a particular burn is a separate act, and #76 owns it.
          tx.insert(accountRole).values({ account_id: accountId, role: 'member' }).run()

          return true
        })
      } catch (error) {
        if (isEmailConflict(error)) return false
        throw error
      }
    })()

    if (!claimed) return reply.code(409).send(errorResponse('conflict'))

    void reply.header(
      'set-cookie',
      cookieHeader(sessions.issue(accountId), config, config.session_ttl_seconds),
    )

    return reply.code(201).send({ viewer: { account_id: accountId, roles: ['member'] } })
  })
}
