import { z } from 'zod'

import { accountRoles } from '../enums.ts'
import { emailSchema, newPasswordSchema } from './auth.ts'
import { dateTimeSchema, idSchema } from './common.ts'

export const adminAccountSchema = z.object({
  id: idSchema,
  email: emailSchema,
  roles: z.array(z.enum(accountRoles)),
  created_at: dateTimeSchema,
})
export type AdminAccount = z.infer<typeof adminAccountSchema>

export const adminAccountsResponseSchema = z.object({ accounts: z.array(adminAccountSchema) })
export type AdminAccountsResponse = z.infer<typeof adminAccountsResponseSchema>

export const adminPasswordResetSchema = z.object({ password: newPasswordSchema }).strict()
export type AdminPasswordReset = z.infer<typeof adminPasswordResetSchema>

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
