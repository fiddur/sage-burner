import type { InviteState, RedeemResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes, inviteStatusOf, redeemRequestSchema } from '@sage-burner/shared'
import { and, eq, isNull } from 'drizzle-orm'
import { createHash, randomUUID } from 'node:crypto'

import type { Gate } from '../auth/gate.ts'
import type { Sessions } from '../auth/session.ts'
import type { Config } from '../config.ts'
import type { Database } from '../db/index.ts'

import { hashPassword } from '../auth/password.ts'
import { account, accountRole, application, inviteToken } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { joinBurn } from './attendance.ts'
import { cookieHeader } from './auth.ts'

export interface RedemptionDeps {
  db: Database
  config: Config
  sessions: Sessions
  now?: () => Date
  hash?: (password: string) => Promise<string>
  /** The scrypt gate, shared with login. See `SCRYPT_GATE`. */
  gate: Gate
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
  { db, config, sessions, now = () => new Date(), hash = hashPassword, gate }: RedemptionDeps,
) => {
  app.get<{ Params: { token: string } }>(apiRoutes.getInviteState.fastify, async (request, reply) => {
    void noStore(reply)

    const [invite] = await db
      .select({
        expires_at: inviteToken.expires_at,
        used_at: inviteToken.used_at,
        applicant_name: application.applicant_name,
      })
      .from(inviteToken)
      // Left: an admin's direct invite has no application behind it, and is still a
      // perfectly good invite. Those simply start the form blank.
      .leftJoin(application, eq(application.id, inviteToken.application_id))
      .where(eq(inviteToken.token_hash, digestOf(request.params.token)))
      .limit(1)

    // 200 with a status either way, and the same shape for all four. This does
    // not hide which of the four it is — `unknown` says so plainly, and anyone
    // holding a string can ask. It could not usefully hide it either: the page
    // has to tell an expired invite from a spent one to say what to do about it,
    // and there is nothing to enumerate, the token being 256 bits of CSPRNG.
    // What the uniform shape buys is one code path for the page rather than a
    // status the fetch layer turns into an error.
    const status = invite === undefined ? 'unknown' : inviteStatusOf(invite, now())

    return {
      status,
      // Only while it is outstanding. A spent or expired link has no form to fill,
      // so naming its applicant would be disclosure bought for nothing.
      name: status === 'outstanding' ? (invite?.applicant_name ?? null) : null,
    } satisfies InviteState
  })

  app.post<{ Params: { token: string } }>(apiRoutes.redeemInvite.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(redeemRequestSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const digest = digestOf(request.params.token)
    const [invite] = await db.select().from(inviteToken).where(eq(inviteToken.token_hash, digest)).limit(1)

    // One answer for unknown, expired and spent alike — not to hide anything (the
    // GET above says which it is, to anyone who asks), but because the client has
    // nothing to do with the difference here. The page has already read the
    // status; by the time it POSTs, every one of the three means the same thing:
    // this link cannot be spent.
    if (invite === undefined || inviteStatusOf(invite, now()) !== 'outstanding') {
      return sendError(reply, 409)
    }

    // Before the taken-address check, and gated, so a refusal costs what a success
    // costs and neither is free. That throttles member enumeration rather than
    // closing it — the status codes still answer the question, and the 409 does
    // not spend the token — which `docs/accounts.md` argues out under "Redeeming".
    //
    // Outside the transaction: holding a write transaction open across scrypt
    // would block every other writer for that long.
    const admission = await gate.enter()
    if (!admission.ok) {
      void reply.header('retry-after', gate.retryAfter(admission.reason))
      request.log.warn({ ...gate.stats(), reason: admission.reason }, 'redemption shed')
      return sendError(reply, 429)
    }

    let password_hash: string
    try {
      password_hash = await hash(body.password)
    } finally {
      admission.release()
    }

    // Checked before the write so the token is not spent on a request that cannot
    // finish: an account whose email is taken has nothing to retry with, and the
    // invite would already be gone. The insert's UNIQUE is still the authority —
    // this only decides which error the caller sees.
    const [taken] = await db
      .select({ id: account.id })
      .from(account)
      .where(eq(account.email, body.email))
      .limit(1)
    if (taken !== undefined) return sendError(reply, 409)
    const accountId = randomUUID()

    // One transaction for the account, its role and the stamp. Half a redemption
    // is the worst outcome — a spent token with no account behind it leaves the
    // person unable to finish with the link they were sent, and that link cannot
    // be re-sent. Somebody with admin can mint a direct invite to get them in;
    // an application's tie to what they wrote is what would be lost (#91).
    //
    // The stamp is conditional on `used_at IS NULL` and requires one affected row,
    // so two concurrent redemptions of one token cannot both proceed: the loser's
    // UPDATE matches nothing and the whole transaction rolls back.
    //
    // `expires_at` is deliberately not re-checked here. The window between the
    // `outstanding` check above and this write is a queue wait plus a hash — up to
    // ~5.2s with `SCRYPT_GATE`, against an invite whose life is measured in days —
    // so an expiry that falls inside it lets the redemption through. Re-checking
    // would refuse someone whose link was live when they pressed the button, which
    // is the worse answer.
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
              email: body.email,
              password_hash,
              name: body.name,
              // The email is a way to reach them, so nobody has to answer "how
              // can we reach you?" on the form where they just typed it.
              contact: body.contact ?? body.email,
              allergies_notes: body.allergies_notes,
              invite_token_id: invite.id,
              created_at: now().toISOString(),
            })
            .run()

          // Redeeming an invite is what makes someone a member. No attendance row
          // here even when the form ticked a burn: joining happens after this
          // transaction and outside it, so a failure to join cannot roll back the
          // token spend — see the comment after this transaction.
          tx.insert(accountRole).values({ account_id: accountId, role: 'member' }).run()

          return true
        })
      } catch (error) {
        if (isEmailConflict(error)) return false
        throw error
      }
    })()

    if (!claimed) return sendError(reply, 409)

    void reply.header(
      'set-cookie',
      cookieHeader(sessions.issue(accountId), config, config.session_ttl_seconds),
    )

    // Outside the transaction above, and after it, on purpose. Redeeming is the one
    // operation whose failure cannot be retried — the token is spent and cannot be
    // re-sent — so nothing optional may be given the power to roll it back. A burn
    // that ended while the form was open, or an id that names nothing, leaves the
    // account made and the box unticked; the page reads `attendance` and says so.
    const wanted = body.join_event_id ?? undefined
    const joined = wanted === undefined ? undefined : await joinBurn(db, wanted, accountId, now)

    return reply.code(201).send({
      // The whole viewer, with `satisfies`: the page reads every field, and
      // `undefined` is not `null` to a control comparing against it.
      viewer: {
        account_id: accountId,
        name: body.name,
        avatar: null,
        roles: ['member'],
      },
      attendance: joined?.stay ?? null,
    } satisfies RedeemResponse)
  })
}
