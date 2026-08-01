import { z } from 'zod'

import { accountRoles } from '../enums.ts'
import { emailSchema } from './auth.ts'
import { dateTimeSchema, idSchema } from './common.ts'

/**
 * An account as an admin sees it.
 *
 * Includes the email, which `viewerSchema` deliberately omits — an organiser
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
