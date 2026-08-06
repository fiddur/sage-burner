import { z } from 'zod'

import { accountRoles } from '../enums.ts'
import { emailSchema, newPasswordSchema } from './auth.ts'
import { dateTimeSchema, idSchema } from './common.ts'

/**
 * An account as an admin sees it.
 *
 * Includes the email, which `viewerSchema` deliberately omits — an admin
 * needs to know who they are looking at, and this response is behind the admin
 * guard. Never the password hash.
 */
export const adminAccountSchema = z.object({
  id: idSchema,
  email: emailSchema,
  roles: z.array(z.enum(accountRoles)),
  created_at: dateTimeSchema,
})
export type AdminAccount = z.infer<typeof adminAccountSchema>

export const adminAccountsResponseSchema = z.object({ accounts: z.array(adminAccountSchema) })
export type AdminAccountsResponse = z.infer<typeof adminAccountsResponseSchema>

/**
 * Setting somebody's password for them.
 *
 * There is no other way to change one once it is set: redemption is where a
 * password is chosen, `admin:create` refuses to touch an existing one, and nothing
 * else writes the column except the silent rehash on login. So an account whose
 * owner has lost the password — or one an admin made and did not write down —
 * had no way back at all.
 *
 * The **old** password is not asked for, because an admin does not have it.
 * That is the whole point, and it is also what makes this the most dangerous route
 * in the app: it is admin taking over any account, including another admin's. At
 * 42 people who all know each other that is the same trust the role already
 * carries; it is written down here so nobody has to infer it.
 */
export const adminPasswordResetSchema = z.object({ password: newPasswordSchema }).strict()
export type AdminPasswordReset = z.infer<typeof adminPasswordResetSchema>

/**
 * The whole set an account should end up with, not a delta.
 *
 * Declarative because the editor is a row of checkboxes: sending what the row
 * now says takes one request and cannot express "add admin, forget to remove
 * member". Duplicates are refused rather than deduped — a client sending
 * `['admin', 'admin']` has a bug, and silently accepting it hides it.
 */
export const accountRolesUpdateSchema = z
  .object({
    roles: z
      .array(z.enum(accountRoles))
      .refine((roles) => new Set(roles).size === roles.length, 'roles must be unique'),
  })
  .strict()
export type AccountRolesUpdate = z.infer<typeof accountRolesUpdateSchema>

export const adminAccountResponseSchema = z.object({ account: adminAccountSchema })
export type AdminAccountResponse = z.infer<typeof adminAccountResponseSchema>
