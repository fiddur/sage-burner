import type { AdminAccount, AdminAccountResponse, AdminAccountsResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { accountRolesUpdateSchema, adminPasswordResetSchema, apiRoutes } from '@sage-burner/shared'
import { count, eq } from 'drizzle-orm'

import type { Database } from '../db/index.ts'

import { hashPassword } from '../auth/password.ts'
import { account, accountRole } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'

export interface AdminDeps {
  db: Database
  hash?: (password: string) => Promise<string>
}

const LAST_ADMIN = new Error('the last admin cannot give up the role')

export const registerAdminRoutes = (app: FastifyInstance, { db, hash = hashPassword }: AdminDeps) => {
  app.get(apiRoutes.getAdminAccounts.fastify, async (_request, reply) => {
    void noStore(reply)

    const rows = await db
      .select({ id: account.id, email: account.email, created_at: account.created_at })
      .from(account)
      .orderBy(account.email)
    const roles = await db.select().from(accountRole)

    const accounts: AdminAccount[] = rows.map((row) => ({
      ...row,
      roles: roles.filter((entry) => entry.account_id === row.id).map((entry) => entry.role),
    }))

    return { accounts } satisfies AdminAccountsResponse
  })

  app.put<{ Params: { accountId: string } }>(apiRoutes.setAccountRoles.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(accountRolesUpdateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const { accountId } = request.params
    const [found] = await db
      .select({ id: account.id, email: account.email, created_at: account.created_at })
      .from(account)
      .where(eq(account.id, accountId))
      .limit(1)
    if (found === undefined) return sendError(reply, 404)

    const { roles } = body

    try {
      db.transaction((tx) => {
        tx.delete(accountRole).where(eq(accountRole.account_id, accountId)).run()
        for (const role of roles) tx.insert(accountRole).values({ account_id: accountId, role }).run()

        const [remaining] = tx
          .select({ admins: count() })
          .from(accountRole)
          .where(eq(accountRole.role, 'admin'))
          .all()

        if ((remaining?.admins ?? 0) === 0) throw LAST_ADMIN
      })
    } catch (failure) {
      if (failure === LAST_ADMIN) return sendError(reply, 409)
      throw failure
    }

    return { account: { ...found, roles } } satisfies AdminAccountResponse
  })

  app.put<{ Params: { accountId: string } }>(apiRoutes.setAccountPassword.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(adminPasswordResetSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const password_hash = await hash(body.password)

    const [updated] = await db
      .update(account)
      .set({ password_hash })
      .where(eq(account.id, request.params.accountId))
      .returning({ id: account.id })

    return updated === undefined ? sendError(reply, 404) : reply.code(204).send()
  })
}
