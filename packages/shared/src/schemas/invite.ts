import { z } from 'zod'

import { MAX_APPLICANT_NAME_LENGTH } from '../answers.ts'
import { inviteStatuses } from '../enums.ts'
import { dateTimeSchema, idSchema } from './common.ts'

export const adminInviteSchema = z.object({
  id: idSchema,
  application_id: idSchema.nullable(),
  applicant_name: z.string().max(MAX_APPLICANT_NAME_LENGTH).nullable(),
  expires_at: dateTimeSchema,
  used_at: dateTimeSchema.nullable(),
  status: z.enum(inviteStatuses),
})

export const adminInvitesResponseSchema = z.object({ invites: z.array(adminInviteSchema) })

export const inviteCreateSchema = z.object({ expires_at: dateTimeSchema.optional() }).strict().default({})

export type AdminInvite = z.infer<typeof adminInviteSchema>
export type AdminInvitesResponse = z.infer<typeof adminInvitesResponseSchema>
export type InviteCreate = z.infer<typeof inviteCreateSchema>
