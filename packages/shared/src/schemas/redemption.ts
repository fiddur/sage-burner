import { z } from 'zod'

import { inviteStatuses } from '../enums.ts'
import { MAX_CONTACT, MAX_NOTES, MAX_PERSON_NAME } from '../limits.ts'
import { emailSchema, meResponseSchema, newPasswordSchema } from './auth.ts'
import { idSchema, nonEmptyText, optionalText } from './common.ts'
import { attendanceSchema } from './membership.ts'

export const inviteStateSchema = z.object({
  status: z.enum([...inviteStatuses, 'unknown']),
  name: z.string().nullable(),
  email: z.string().nullable(),
})

export const redeemRequestSchema = z
  .object({
    email: emailSchema,
    password: newPasswordSchema,
    name: nonEmptyText(MAX_PERSON_NAME),
    contact: optionalText(MAX_CONTACT).optional(),
    allergies_notes: optionalText(MAX_NOTES),
    join_event_id: idSchema.nullable().optional(),
  })
  .strict()

export const redeemResponseSchema = meResponseSchema.extend({
  attendance: attendanceSchema.nullable(),
})

export type InviteState = z.infer<typeof inviteStateSchema>
export type RedeemRequest = z.infer<typeof redeemRequestSchema>
export type RedeemResponse = z.infer<typeof redeemResponseSchema>

export type RedeemRequestInput = z.input<typeof redeemRequestSchema>
