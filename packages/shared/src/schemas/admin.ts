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
