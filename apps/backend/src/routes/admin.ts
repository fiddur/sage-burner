import type {
  AdminAccount,
  AdminAccountDetail,
  AdminAccountDetailResponse,
  AdminAccountResponse,
  AdminAccountsResponse,
} from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import {
  accountRolesUpdateSchema,
  adminAccountUpdateSchema,
  adminPasswordResetSchema,
  apiRoutes,
} from '@sage-burner/shared'
import { count, eq } from 'drizzle-orm'

import type { Database } from '../db/index.ts'

import { hashPassword } from '../auth/password.ts'
import { dropResets } from '../auth/reset.ts'
import { isForeignKeyViolation, isUniqueViolation } from '../db/errors.ts'
import { isEmptyPatch } from '../db/patch.ts'
import { account, accountRole, passkey } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { identitiesFor } from '../oauth/identities.ts'
import { allergyTickIdsFor, writeAllergyTicks } from './allergy-ticks.ts'

export interface AdminDeps {
  db: Database
  hash?: (password: string) => Promise<string>
}

const LAST_ADMIN = new Error('the last admin cannot give up the role')

const detailOf = async (db: Database, accountId: string): Promise<AdminAccountDetail | undefined> => {
  const [row] = await db
    .select({
      id: account.id,
      email: account.email,
      name: account.name,
      created_at: account.created_at,
      password_hash: account.password_hash,
      allergies_notes: account.allergies_notes,
    })
    .from(account)
    .where(eq(account.id, accountId))
    .limit(1)
  if (row === undefined) return undefined

  const roles = await db.select().from(accountRole).where(eq(accountRole.account_id, accountId))
  const [keys] = await db.select({ held: count() }).from(passkey).where(eq(passkey.account_id, accountId))
  const identities = await identitiesFor(db, accountId)

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    roles: roles.map((entry) => entry.role),
    created_at: row.created_at,
    has_password: row.password_hash !== null,
    passkeys: keys?.held ?? 0,
    identities: identities.map((identity) => identity.provider),
    allergies_notes: row.allergies_notes,
    allergy_item_ids: await allergyTickIdsFor(db, accountId),
  }
}

export const registerAdminRoutes = (app: FastifyInstance, { db, hash = hashPassword }: AdminDeps) => {
  app.get(apiRoutes.getAdminAccounts.fastify, async (_request, reply) => {
    void noStore(reply)

    const rows = await db
      .select({ id: account.id, email: account.email, name: account.name, created_at: account.created_at })
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
      .select({ id: account.id, email: account.email, name: account.name, created_at: account.created_at })
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

  app.get<{ Params: { accountId: string } }>(apiRoutes.getAdminAccount.fastify, async (request, reply) => {
    void noStore(reply)

    const detail = await detailOf(db, request.params.accountId)

    return detail === undefined
      ? sendError(reply, 404)
      : ({ account: detail } satisfies AdminAccountDetailResponse)
  })

  app.patch<{ Params: { accountId: string } }>(
    apiRoutes.updateAdminAccount.fastify,
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(adminAccountUpdateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const { accountId } = request.params
      const { allergy_item_ids: ticks, ...columns } = body

      let found: boolean
      try {
        found = db.transaction((tx) => {
          const [row] = tx
            .select({ id: account.id, email: account.email })
            .from(account)
            .where(eq(account.id, accountId))
            .all()
          if (row === undefined) return false

          if (!isEmptyPatch(columns)) tx.update(account).set(columns).where(eq(account.id, accountId)).run()
          // The link went to the address that was there, so only a move invalidates it — and the
          // page posts every field on every save, so `!== undefined` would be any edit at all.
          if (columns.email !== undefined && columns.email !== row.email) dropResets(tx, accountId)
          if (ticks !== undefined) writeAllergyTicks(tx, accountId, ticks)

          return true
        })
      } catch (failure) {
        if (isUniqueViolation(failure, 'account.email')) return sendError(reply, 409)
        if (isForeignKeyViolation(failure)) return sendError(reply, 400)
        throw failure
      }
      if (!found) return sendError(reply, 404)

      const detail = await detailOf(db, accountId)

      return detail === undefined
        ? sendError(reply, 404)
        : ({ account: detail } satisfies AdminAccountDetailResponse)
    },
  )

  app.put<{ Params: { accountId: string } }>(apiRoutes.setAccountPassword.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(adminPasswordResetSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const password_hash = await hash(body.password)
    const { accountId } = request.params

    const updated = db.transaction((tx) => {
      const [row] = tx
        .update(account)
        .set({ password_hash })
        .where(eq(account.id, accountId))
        .returning({ id: account.id })
        .all()

      if (row === undefined) return undefined

      dropResets(tx, accountId)

      return row
    })

    return updated === undefined ? sendError(reply, 404) : reply.code(204).send()
  })
}
