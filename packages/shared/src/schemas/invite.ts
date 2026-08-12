import { z } from 'zod'

import { MAX_APPLICANT_NAME_LENGTH } from '../answers.ts'
import { inviteKinds, inviteStatuses } from '../enums.ts'
import { MAX_GROUP_INVITE_USES, MAX_INVITE_LABEL } from '../limits.ts'
import { dateTimeSchema, idSchema } from './common.ts'

export const inviteRedemptionSchema = z.object({
  account_id: idSchema,
  name: z.string().nullable(),
  redeemed_at: dateTimeSchema,
})

export const adminInviteSchema = z.object({
  id: idSchema,
  kind: z.enum(inviteKinds),
  application_id: idSchema.nullable(),
  applicant_name: z.string().max(MAX_APPLICANT_NAME_LENGTH).nullable(),
  label: z.string().max(MAX_INVITE_LABEL).nullable(),
  expires_at: dateTimeSchema,
  used_at: dateTimeSchema.nullable(),
  revoked_at: dateTimeSchema.nullable(),
  max_uses: z.number().int().positive().nullable(),
  redemptions: z.array(inviteRedemptionSchema),
  status: z.enum(inviteStatuses),
})

export const adminInvitesResponseSchema = z.object({ invites: z.array(adminInviteSchema) })

export const inviteCreateSchema = z.object({ expires_at: dateTimeSchema.optional() }).strict().default({})

export const groupInviteCreateSchema = z
  .object({
    expires_at: dateTimeSchema,
    max_uses: z.number().int().positive().max(MAX_GROUP_INVITE_USES).nullable().default(null),
    label: z.string().trim().min(1).max(MAX_INVITE_LABEL),
  })
  .strict()

export type AdminInvite = z.infer<typeof adminInviteSchema>
export type AdminInvitesResponse = z.infer<typeof adminInvitesResponseSchema>
export type InviteCreate = z.infer<typeof inviteCreateSchema>
export type GroupInviteCreate = z.infer<typeof groupInviteCreateSchema>
export type InviteRedemption = z.infer<typeof inviteRedemptionSchema>
