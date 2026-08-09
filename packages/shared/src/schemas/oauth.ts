import { z } from 'zod'

import { oauthProviders } from '../enums.ts'
import { MAX_OAUTH_CLIENT_ID, MAX_OAUTH_CLIENT_SECRET } from '../limits.ts'
import { dateTimeSchema } from './common.ts'

/**
 * What an admin fills in to let people sign in from somewhere else (#393).
 *
 * In the database and set by an admin, not in the environment — the same argument
 * `mail_setting` and the VAPID pair make: `docker compose up` has to stay sufficient, and
 * an installation that never wants this never configures one. Nothing here is required to
 * boot and nothing fails without it.
 *
 * There is no hosted service behind this beyond the provider's own. What it costs outside
 * the code differs between them, which is why Discord is worth having first: an app in the
 * developer portal and the `identify` scope, no review. Facebook wants an app, a
 * privacy-policy URL and review for `public_profile` before anybody outside the developer
 * account can use the button.
 */
export const oauthSettingsFields = z.object({
  client_id: z.string().trim().min(1).max(MAX_OAUTH_CLIENT_ID),
})

/**
 * What an admin reads back. **Never the secret.**
 *
 * `has_secret` rather than the value or a row of asterisks, exactly as
 * `mailSettingsSchema` does it: the form has to say whether one is stored, and a masked
 * value invites a save that writes the mask.
 */
export const oauthSettingsSchema = oauthSettingsFields.extend({
  provider: z.enum(oauthProviders),
  has_secret: z.boolean(),
  updated_at: dateTimeSchema,
})
export type OAuthSettings = z.infer<typeof oauthSettingsSchema>

/**
 * Setting it up, or changing it.
 *
 * `client_secret` is optional and that is the whole of how it survives an edit: absent
 * means keep what is stored, empty means clear it. A form that had to re-type the secret
 * to correct a typo in the id would keep the secret in a text input on every visit.
 */
export const oauthSettingsUpdateSchema = oauthSettingsFields
  .extend({ client_secret: z.string().max(MAX_OAUTH_CLIENT_SECRET).optional() })
  .strict()
export type OAuthSettingsUpdate = z.infer<typeof oauthSettingsUpdateSchema>

/** Null is the ordinary answer: most installations configure neither provider. */
export const oauthSettingsResponseSchema = z.object({ settings: oauthSettingsSchema.nullable() })
export type OAuthSettingsResponse = z.infer<typeof oauthSettingsResponseSchema>

/**
 * A way in that somebody has linked to their account.
 *
 * **The provider's id for them is not here.** It is stored, because matching it is the
 * whole mechanism, but nothing needs to read it back — and Facebook's is app-scoped while
 * Discord's is a global snowflake, so one of the two would be comparable across
 * installations if it ever left this process.
 */
export const identitySchema = z.object({
  provider: z.enum(oauthProviders),
  created_at: dateTimeSchema,
})
export type Identity = z.infer<typeof identitySchema>

export const identitiesResponseSchema = z.object({ identities: z.array(identitySchema) })
export type IdentitiesResponse = z.infer<typeof identitiesResponseSchema>
