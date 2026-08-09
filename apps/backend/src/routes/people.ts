import type { PersonProfile, PersonProfileResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'

import type { GuardDeps } from '../auth/guards.ts'

import { createGuards } from '../auth/guards.ts'
import { account, accountAvatar } from '../db/schema.ts'
import { noStore, sendError } from '../http.ts'
import { connectionsFor } from './connections.ts'

/**
 * Somebody, as the rest of the community sees them (#389).
 *
 * `requireApproved`, the same guard as the face beside the name: a page that answers "how
 * do I get hold of this person" is exactly as private as the attendee list it is reached
 * from, and no more.
 *
 * **The projection is an object literal**, in the manner of `asMemberEntry`, and that is
 * the safety property rather than tidiness — a column added to `account` reaches every
 * member's reading of every other member only when somebody names it here. Spreading the
 * row and deleting keys would not have that property.
 *
 * An account holding `admin` and not `member` has a page too: organising without attending
 * is coherent here, and that is often the person most in need of reaching.
 */
export const registerPeopleRoutes = (app: FastifyInstance, { db, sessions }: GuardDeps) => {
  const { requireApproved } = createGuards({ db, sessions })

  app.get<{ Params: { accountId: string } }>(
    apiRoutes.accountProfile.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const { accountId } = request.params

      const [row] = await db
        .select({
          account_id: account.id,
          name: account.name,
          contact: account.contact,
          avatar: accountAvatar.updated_at,
        })
        .from(account)
        .leftJoin(accountAvatar, eq(accountAvatar.account_id, account.id))
        .where(eq(account.id, accountId))
        .limit(1)

      // A page for a gone account should not be linked from anywhere — every name is drawn
      // from a row that cascades — but a tab somebody left open still wants a 404 that
      // reads as one.
      if (row === undefined) return sendError(reply, 404)

      const person: PersonProfile = {
        account_id: row.account_id,
        name: row.name,
        avatar: row.avatar,
        connections: await connectionsFor(db, accountId),
        contact: row.contact,
      }

      return { person } satisfies PersonProfileResponse
    },
  )
}
