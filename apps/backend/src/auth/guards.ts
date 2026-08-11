import type { AccountRole } from '@sage-burner/shared'
import type { FastifyReply, FastifyRequest } from 'fastify'

import type { Database } from '../db/index.ts'
import type { Sessions } from './session.ts'

import { sendError } from '../http.ts'
import { viewerFor } from './viewer.ts'

export interface GuardDeps {
  db: Database
  sessions: Sessions
}

export const createGuards = ({ db, sessions }: GuardDeps) => {
  const guard =
    (...roles: [AccountRole, ...AccountRole[]]) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const viewer = await viewerFor(request, { db, sessions })

      if (viewer === undefined) return sendError(reply, 401)
      if (!roles.some((role) => viewer.roles.includes(role))) {
        return sendError(reply, 403)
      }

      return undefined
    }

  /**
   * Signed in at all, which is what an account with no roles yet is. Account-first sign-up (#476)
   * makes that a state somebody lives in rather than a moment: their own application, and the push
   * they turn on while waiting for it, are the whole of what it reaches.
   */
  const requireSignedIn = async (request: FastifyRequest, reply: FastifyReply) => {
    const viewer = await viewerFor(request, { db, sessions })

    return viewer === undefined ? sendError(reply, 401) : undefined
  }

  return {
    requireAdmin: guard('admin'),
    requireMember: guard('member'),
    requireApproved: guard('member', 'admin'),
    requireSignedIn,
  }
}
