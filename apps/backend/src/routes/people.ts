import type { PersonProfile, PersonProfileResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes, facebookProfileUrl } from '@sage-burner/shared'
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
          introduction: account.introduction,
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

      const connections = await connectionsFor(db, accountId)

      /**
       * Their Facebook page, from the handle they typed for Messenger.
       *
       * **Not from the linked identity**, which is the obvious source and the wrong one:
       * Facebook answers `public_profile` with an *app-scoped* id, which identifies nobody
       * outside this installation's Meta app, so a URL built from it would be a link to
       * nobody on every member's profile. `schema.ts` says the subject is never sent back
       * out, and this keeps that true.
       *
       * A value somebody typed is their real handle or the number out of their own profile
       * link, so both this and the `m.me` the list draws point somewhere.
       */
      const messenger = connections.find((connection) => connection.kind === 'messenger')

      const person: PersonProfile = {
        account_id: row.account_id,
        name: row.name,
        avatar: row.avatar,
        introduction: row.introduction,
        connections,
        contact: row.contact,
        facebook: messenger === undefined ? null : facebookProfileUrl(messenger.value),
      }

      return { person } satisfies PersonProfileResponse
    },
  )
}
