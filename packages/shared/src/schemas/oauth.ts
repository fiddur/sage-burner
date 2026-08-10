import { z } from 'zod'

import { oauthProviders } from '../enums.ts'
import { MAX_OAUTH_CLIENT_ID, MAX_OAUTH_CLIENT_SECRET } from '../limits.ts'
import { dateTimeSchema } from './common.ts'

export const oauthSettingsFields = z.object({
  client_id: z.string().trim().min(1).max(MAX_OAUTH_CLIENT_ID),
  ask_profile_link: z.boolean(),
})

export const oauthSettingsSchema = oauthSettingsFields.extend({
  provider: z.enum(oauthProviders),
  has_secret: z.boolean(),
  updated_at: dateTimeSchema,
})
export type OAuthSettings = z.infer<typeof oauthSettingsSchema>

export const oauthSettingsUpdateSchema = oauthSettingsFields
  .extend({
    client_secret: z.string().max(MAX_OAUTH_CLIENT_SECRET).optional(),
    ask_profile_link: z.boolean().optional(),
  })
  .strict()
export type OAuthSettingsUpdate = z.infer<typeof oauthSettingsUpdateSchema>

export const oauthSettingsResponseSchema = z.object({ settings: oauthSettingsSchema.nullable() })
export type OAuthSettingsResponse = z.infer<typeof oauthSettingsResponseSchema>

export const identitySchema = z.object({
  provider: z.enum(oauthProviders),
  created_at: dateTimeSchema,
})
export type Identity = z.infer<typeof identitySchema>

export const identitiesResponseSchema = z.object({ identities: z.array(identitySchema) })
export type IdentitiesResponse = z.infer<typeof identitiesResponseSchema>
