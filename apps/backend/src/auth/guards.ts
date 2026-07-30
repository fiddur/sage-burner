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
 * 401 and 403 are deliberately different answers. 401 means "sign in", and the
 * client acts on it by sending the visitor to the login page. 403 means "signed
 * in, but not allowed" — sending *that* to login would bounce a member around a
 * loop they can never leave, since logging in again changes nothing.
 */
export const createGuards = ({ db, sessions }: GuardDeps) => {
  const guard = (role?: AccountRole) => async (request: FastifyRequest, reply: FastifyReply) => {
    const viewer = await viewerFor(request, { db, sessions })

    if (viewer === undefined) return reply.code(401).send(errorResponse('unauthenticated'))
    if (role !== undefined && !viewer.roles.includes(role)) {
      return reply.code(403).send(errorResponse('forbidden'))
    }

    return undefined
  }

  return { requireSignedIn: guard(), requireAdmin: guard('admin') }
}
