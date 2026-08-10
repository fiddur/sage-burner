import { z } from 'zod'

import { MAX_EMAIL, MAX_FROM_NAME, MAX_SMTP_HOST, MAX_SMTP_PASSWORD, MAX_SMTP_USERNAME } from '../limits.ts'
import { dateTimeSchema } from './common.ts'

export const mailSettingsFields = z.object({
  host: z.string().trim().min(1).max(MAX_SMTP_HOST),
  port: z.int().min(1).max(65_535),
  secure: z.boolean(),
  username: z.string().trim().max(MAX_SMTP_USERNAME),
  from_email: z.email().max(MAX_EMAIL),
  from_name: z.string().trim().max(MAX_FROM_NAME),
})

export const mailSettingsSchema = mailSettingsFields.extend({
  has_password: z.boolean(),
  updated_at: dateTimeSchema,
})
export type MailSettings = z.infer<typeof mailSettingsSchema>

export const mailSettingsUpdateSchema = mailSettingsFields
  .extend({ password: z.string().max(MAX_SMTP_PASSWORD).optional() })
  .strict()
export type MailSettingsUpdate = z.infer<typeof mailSettingsUpdateSchema>

export const mailSettingsResponseSchema = z.object({ mail: mailSettingsSchema.nullable() })
export type MailSettingsResponse = z.infer<typeof mailSettingsResponseSchema>

export const mailTestResponseSchema = z.object({
  sent: z.boolean(),
  to: z.email(),
  reason: z.string().nullable(),
})
export type MailTestResponse = z.infer<typeof mailTestResponseSchema>
