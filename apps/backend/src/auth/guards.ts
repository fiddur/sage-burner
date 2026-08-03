import type { AccountRole } from '@sage-burner/shared'
import type { FastifyReply, FastifyRequest } from 'fastify'

import { errorResponse } from '@sage-burner/shared'

import type { Database } from '../db/index.ts'
import type { Sessions } from './session.ts'

import { viewerFor } from '../routes/auth.ts'

export interface GuardDeps {
  db: Database
  sessions: Sessions
}

/**
 * `preHandler` guards. Authorization is here, not in the UI.
 *
 * 401 and 403 are deliberately different answers, and the difference is the
 * contract the client is expected to honour: 401 is its cue to send the visitor
 * to login, 403 must never be — that would bounce a member around a loop they
 * can never leave, since logging in again changes nothing.
 *
 * Stated as intent rather than as description. Nothing in `apps/web` navigates
 * on a 401 today; both are rendered as a message. The reason the codes differ
 * holds either way, but the comment should not claim behaviour that is not
 * there yet.
 */
export const createGuards = ({ db, sessions }: GuardDeps) => {
  // At least one role is required, so there is no role-less branch to leave
  // untested. An admin is not automatically a member: the two roles are separate
  // rows in `account_role`, and redemption grants only `member`.
  const guard =
    (...roles: [AccountRole, ...AccountRole[]]) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const viewer = await viewerFor(request, { db, sessions })

      if (viewer === undefined) return reply.code(401).send(errorResponse('unauthenticated'))
      if (!roles.some((role) => viewer.roles.includes(role))) {
        return reply.code(403).send(errorResponse('forbidden'))
      }

      return undefined
    }

  return {
    requireAdmin: guard('admin'),
    requireMember: guard('member'),
    /**
     * Anyone who is in — the gate for what the shared spreadsheet let everyone
     * edit.
     *
     * `admin` counts, and has to: the bootstrapped account holds `admin` alone
     * (redemption is what grants `member`), so a `member`-only guard would lock
     * the person setting the first burn up out of setting it up. Neither role
     * implies the other anywhere else, which is why this is a third guard rather
     * than a change to `requireMember`.
     */
    requireApproved: guard('member', 'admin'),
  }
}
