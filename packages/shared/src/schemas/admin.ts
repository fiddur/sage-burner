import { z } from 'zod'

import { accountRoles, oauthProviders } from '../enums.ts'
import { MAX_NOTES, MAX_PERSON_NAME } from '../limits.ts'
import { emailSchema, newPasswordSchema } from './auth.ts'
import { dateTimeSchema, idSchema, nonEmptyText, optionalText } from './common.ts'

export const adminAccountSchema = z.object({
  id: idSchema,
  email: emailSchema,
  name: z.string().nullable(),
  roles: z.array(z.enum(accountRoles)),
  created_at: dateTimeSchema,
})
export type AdminAccount = z.infer<typeof adminAccountSchema>

export const adminAccountDetailSchema = adminAccountSchema.extend({
  has_password: z.boolean(),
  passkeys: z.int().nonnegative(),
  identities: z.array(z.enum(oauthProviders)),
  allergies_notes: optionalText(MAX_NOTES),
  allergy_item_ids: z.array(idSchema),
})
export type AdminAccountDetail = z.infer<typeof adminAccountDetailSchema>

export const adminAccountDetailResponseSchema = z.object({ account: adminAccountDetailSchema })
export type AdminAccountDetailResponse = z.infer<typeof adminAccountDetailResponseSchema>

export const adminAccountUpdateSchema = z
  .object({
    name: nonEmptyText(MAX_PERSON_NAME),
    email: emailSchema,
    allergies_notes: optionalText(MAX_NOTES),
    allergy_item_ids: z.array(idSchema),
  })
  .partial()
  .strict()
export type AdminAccountUpdate = z.infer<typeof adminAccountUpdateSchema>

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
