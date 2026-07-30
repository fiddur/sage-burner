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
  // `role` is required. There was a `requireSignedIn` here built from
  // `guard(undefined)`, with no caller and no test — so the role-less branch was
  // dead code guarding nothing. The factory shape makes it a one-liner to add
  // back when the first member-only route needs it, and it should arrive with a
  // real caller and the test that distinguishes it from this one: 200 for a
  // signed-in account with no roles at all.
  const guard = (role: AccountRole) => async (request: FastifyRequest, reply: FastifyReply) => {
    const viewer = await viewerFor(request, { db, sessions })

    if (viewer === undefined) return reply.code(401).send(errorResponse('unauthenticated'))
    if (!viewer.roles.includes(role)) return reply.code(403).send(errorResponse('forbidden'))

    return undefined
  }

  return { requireAdmin: guard('admin') }
}
