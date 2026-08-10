import type { PersonProfile, PersonProfileResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes, facebookProfileUrl } from '@sage-burner/shared'
import { and, eq } from 'drizzle-orm'

import type { GuardDeps } from '../auth/guards.ts'

import { createGuards } from '../auth/guards.ts'
import { account, accountAvatar, accountIdentity } from '../db/schema.ts'
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
       * Their Facebook page — the handle they typed for Messenger first, and a linked sign-in
       * second (#405).
       *
       * **The typed handle wins**, because it is the better of the two links: it builds
       * `facebook.com/wren`, which resolves for anybody, while Facebook's own `link` only
       * resolves for a viewer who is logged in *and* already a friend. So the linked URL is a
       * fallback for somebody who never typed a handle, not an upgrade over one.
       *
       * **Still never the subject.** `public_profile`'s id is app-scoped and identifies nobody
       * outside this installation's Meta app; `profile_url` is a URL Facebook itself answered,
       * which is a different thing, and `schema.ts` keeps the subject from ever leaving.
       */
      const messenger = connections.find((connection) => connection.kind === 'messenger')

      const [linked] = await db
        .select({ profile_url: accountIdentity.profile_url })
        .from(accountIdentity)
        .where(and(eq(accountIdentity.account_id, accountId), eq(accountIdentity.provider, 'facebook')))
        .limit(1)

      const person: PersonProfile = {
        account_id: row.account_id,
        name: row.name,
        avatar: row.avatar,
        introduction: row.introduction,
        connections,
        contact: row.contact,
        facebook:
          messenger === undefined ? (linked?.profile_url ?? null) : facebookProfileUrl(messenger.value),
      }

      return { person } satisfies PersonProfileResponse
    },
  )
}
