import type { ApprovedAccountsResponse, PersonProfile, PersonProfileResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes, facebookProfileUrl } from '@sage-burner/shared'
import { and, asc, eq, inArray } from 'drizzle-orm'

import type { GuardDeps } from '../auth/guards.ts'

import { createGuards } from '../auth/guards.ts'
import { account, accountAvatar, accountIdentity, accountRole } from '../db/schema.ts'
import { noStore, sendError } from '../http.ts'
import { connectionsFor } from './connections.ts'

export const registerPeopleRoutes = (app: FastifyInstance, { db, sessions }: GuardDeps) => {
  const { requireApproved } = createGuards({ db, sessions })

  app.get(apiRoutes.getApprovedAccounts.fastify, { preHandler: requireApproved }, async (_request, reply) => {
    void noStore(reply)

    const rows = await db
      .selectDistinct({ account_id: account.id, name: account.name, avatar: accountAvatar.updated_at })
      .from(account)
      .innerJoin(accountRole, eq(accountRole.account_id, account.id))
      .leftJoin(accountAvatar, eq(accountAvatar.account_id, account.id))
      .where(inArray(accountRole.role, ['admin', 'member']))
      .orderBy(asc(account.name), asc(account.id))

    return { accounts: rows } satisfies ApprovedAccountsResponse
  })

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

      if (row === undefined) return sendError(reply, 404)

      const connections = await connectionsFor(db, accountId)

      const messenger = connections.find((connection) => connection.kind === 'messenger')

      const linked =
        messenger !== undefined
          ? undefined
          : (
              await db
                .select({ profile_url: accountIdentity.profile_url })
                .from(accountIdentity)
                .where(
                  and(eq(accountIdentity.account_id, accountId), eq(accountIdentity.provider, 'facebook')),
                )
                .limit(1)
            )[0]

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
