import { z } from 'zod'

import { isProfileUrl, oauthProviders } from '../enums.ts'
import { MAX_MAP_URL, MAX_TITLE } from '../limits.ts'
import { dateTimeSchema, nonEmptyText } from './common.ts'

export const installationSchema = z.object({
  title: nonEmptyText(MAX_TITLE),
  banner_updated_at: dateTimeSchema.nullable(),
  icon_updated_at: dateTimeSchema.nullable(),
  sends_email: z.boolean(),
  knows_own_address: z.boolean(),
  social_logins: z.array(z.enum(oauthProviders)),
})

export const installationResponseSchema = z.object({
  installation: installationSchema,
})

export const installationUpdateSchema = installationSchema
  .omit({
    banner_updated_at: true,
    icon_updated_at: true,
    sends_email: true,
    knows_own_address: true,
    social_logins: true,
  })
  .partial()
  .strict()

export type Installation = z.infer<typeof installationSchema>
export type InstallationResponse = z.infer<typeof installationResponseSchema>
export type InstallationUpdate = z.infer<typeof installationUpdateSchema>

export const mapLinkSchema = z.object({ url: z.string().max(MAX_MAP_URL).nullable() })

export const mapLinkResponseSchema = z.object({ map: mapLinkSchema })

export const mapLinkUpdateSchema = z
  .object({
    url: z
      .string()
      .trim()
      .max(MAX_MAP_URL)
      .nullable()
      .refine((url) => url === null || isProfileUrl(url), {
        error: 'a map link must be an https:// address',
      }),
  })
  .strict()

export type MapLink = z.infer<typeof mapLinkSchema>
export type MapLinkResponse = z.infer<typeof mapLinkResponseSchema>
export type MapLinkUpdate = z.infer<typeof mapLinkUpdateSchema>
