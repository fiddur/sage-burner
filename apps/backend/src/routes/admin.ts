import type { AdminAccount, AdminAccountsResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import type { GuardDeps } from '../auth/guards.ts'

import { createGuards } from '../auth/guards.ts'
import { account, accountRole } from '../db/schema.ts'
import { noStore } from '../http.ts'

/**
 * Admin-only reads.
 *
 * One route for now — the roster. It is what proves the guard works end to end,
 * and it is the first thing an organiser needs after bootstrapping themselves
 * in: whether anyone else exists yet.
 */
export const registerAdminRoutes = (app: FastifyInstance, { db, sessions }: GuardDeps) => {
  const { requireAdmin } = createGuards({ db, sessions })

  app.get('/api/admin/accounts', { preHandler: requireAdmin }, async (_request, reply) => {
    // Every account's email address. An organiser opening this on a shared
    // laptop would otherwise leave the whole roster in the browser's on-disk
    // cache, which outlives the session — logging out clears the cookie, not
    // the cache entry.
    void noStore(reply)

    // Two queries and a group, rather than a join. A left join would work but
    // returns one row per role to unpick, and at 42 members the simpler shape
    // wins. An *inner* join would be wrong outright: it drops accounts with no
    // role, which is precisely who an organiser is looking for.
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
}
