import type { AdminAccount, AdminAccountResponse, AdminAccountsResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import {
  accountRolesUpdateSchema,
  adminPasswordResetSchema,
  apiRoutes,
  errorResponse,
} from '@sage-burner/shared'
import { count, eq } from 'drizzle-orm'

import type { GuardDeps } from '../auth/guards.ts'

import { hashPassword } from '../auth/password.ts'
import { account, accountRole } from '../db/schema.ts'
import { noStore } from '../http.ts'

export interface AdminDeps extends GuardDeps {
  /** Injected so the suite never pays for scrypt, the same seam redemption uses. */
  hash?: (password: string) => Promise<string>
}

/** Thrown to roll the transaction back; never leaves this module. */
const LAST_ADMIN = new Error('the last organiser cannot give up the role')

/**
 * Who exists, and who holds which role.
 *
 * The list is the first thing an organiser needs after bootstrapping themselves
 * in: whether anyone else is here yet. Editing the roles is the second — the only
 * way to change a role from inside the app. `admin:create` can grant both to an
 * address that already exists, but that is a shell on the server, not something an
 * organiser does.
 */
export const registerAdminRoutes = (app: FastifyInstance, { db, hash = hashPassword }: AdminDeps) => {
  app.get(apiRoutes.getAdminAccounts.fastify, async (_request, reply) => {
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

  app.put<{ Params: { accountId: string } }>(apiRoutes.setAccountRoles.fastify, async (request, reply) => {
    void noStore(reply)

    const parsed = accountRolesUpdateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

    const { accountId } = request.params
    const [found] = await db
      .select({ id: account.id, email: account.email, created_at: account.created_at })
      .from(account)
      .where(eq(account.id, accountId))
      .limit(1)
    if (found === undefined) return reply.code(404).send(errorResponse('not_found'))

    const { roles } = parsed.data

    // Counted inside the transaction, after the write, so the rule is decided
    // against the state the write actually produced with nothing in between,
    // and a `throw` rolls the whole thing back. A count taken beforehand is a
    // check-then-act; two `inject` requests could not be made to interleave one
    // here, the same limitation `isAlreadyJoined` in `attendance.ts` records,
    // so this is ordering that costs nothing rather than a reproduced bug.
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
      if (failure === LAST_ADMIN) return reply.code(409).send(errorResponse('conflict'))
      throw failure
    }

    return { account: { ...found, roles } } satisfies AdminAccountResponse
  })

  /**
   * Setting somebody's password for them.
   *
   * No old password, because an organiser does not have it — which is the point, and
   * also what makes this the most powerful route here. Under `/api/admin/`, so the
   * prefix hook is the only thing that lets it through.
   *
   * **It does not end their existing sessions.** Sessions are stateless signed
   * cookies with a TTL and there is nothing to revoke them against, so a reset locks
   * nobody out of a browser already signed in. That is fine for the case this exists
   * for — a password lost or never written down — and not fine for a compromised
   * account, which wants a session version to bump. Said plainly rather than left
   * for somebody to discover.
   */
  app.put<{ Params: { accountId: string } }>(apiRoutes.setAccountPassword.fastify, async (request, reply) => {
    void noStore(reply)

    const parsed = adminPasswordResetSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

    // Hashed before the row is looked for, so a real account and a made-up one cost
    // the same. Not much of an oracle behind the admin guard, but it is one line.
    const password_hash = await hash(parsed.data.password)

    const [updated] = await db
      .update(account)
      .set({ password_hash })
      .where(eq(account.id, request.params.accountId))
      .returning({ id: account.id })

    // Nothing is echoed back: the caller already knows what they set, and a
    // password in a response body is a password in somebody's network log.
    return updated === undefined ? reply.code(404).send(errorResponse('not_found')) : reply.code(204).send()
  })
}
