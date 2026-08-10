import { z } from 'zod'

import { oauthProviders } from '../enums.ts'
import { MAX_TITLE } from '../limits.ts'
import { dateTimeSchema, nonEmptyText } from './common.ts'

export const installationSchema = z.object({
  title: nonEmptyText(MAX_TITLE),
  banner_updated_at: dateTimeSchema.nullable(),
  icon_updated_at: dateTimeSchema.nullable(),
  sends_email: z.boolean(),
  social_logins: z.array(z.enum(oauthProviders)),
})

export const installationResponseSchema = z.object({
  installation: installationSchema,
})

export const installationUpdateSchema = installationSchema
  .omit({ banner_updated_at: true, icon_updated_at: true, sends_email: true, social_logins: true })
  .partial()
  .strict()

export type Installation = z.infer<typeof installationSchema>
export type InstallationResponse = z.infer<typeof installationResponseSchema>
export type InstallationUpdate = z.infer<typeof installationUpdateSchema>
