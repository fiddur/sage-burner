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
