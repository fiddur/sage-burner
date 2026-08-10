import { z } from 'zod'

import { MAX_PASSKEY_LABEL } from '../limits.ts'
import { dateTimeSchema, idSchema, nonEmptyText } from './common.ts'

const ceremonyField = z.string().min(1).max(16_384)

const clientExtensionResultsSchema = z
  .object({
    appid: z.boolean().optional(),
    credProps: z.object({ rk: z.boolean().optional() }).optional(),
    hmacCreateSecret: z.boolean().optional(),
  })
  .default({})

export const registrationResponseSchema = z.object({
  id: ceremonyField,
  rawId: ceremonyField,
  response: z.object({
    clientDataJSON: ceremonyField,
    attestationObject: ceremonyField,
    authenticatorData: ceremonyField.optional(),
    transports: z.array(z.string().max(64)).max(16).optional(),
    publicKeyAlgorithm: z.number().int().optional(),
    publicKey: ceremonyField.optional(),
  }),
  authenticatorAttachment: z.enum(['cross-platform', 'platform']).optional(),
  clientExtensionResults: clientExtensionResultsSchema,
  type: z.literal('public-key'),
})

export const authenticationResponseSchema = z.object({
  id: ceremonyField,
  rawId: ceremonyField,
  response: z.object({
    clientDataJSON: ceremonyField,
    authenticatorData: ceremonyField,
    signature: ceremonyField,
    userHandle: ceremonyField.optional(),
  }),
  authenticatorAttachment: z.enum(['cross-platform', 'platform']).optional(),
  clientExtensionResults: clientExtensionResultsSchema,
  type: z.literal('public-key'),
})

export const passkeyLabelSchema = nonEmptyText(MAX_PASSKEY_LABEL)

export const passkeySchema = z.object({
  id: idSchema,
  label: passkeyLabelSchema,
  created_at: dateTimeSchema,
  last_used_at: dateTimeSchema.nullable(),
})
export type Passkey = z.infer<typeof passkeySchema>

export const passkeysResponseSchema = z.object({ passkeys: z.array(passkeySchema) })
export type PasskeysResponse = z.infer<typeof passkeysResponseSchema>

export const passkeyRegistrationSchema = z.object({
  label: passkeyLabelSchema,
  response: registrationResponseSchema,
})
export type PasskeyRegistration = z.infer<typeof passkeyRegistrationSchema>

export const passkeyLoginSchema = z.object({ response: authenticationResponseSchema })
export type PasskeyLogin = z.infer<typeof passkeyLoginSchema>
