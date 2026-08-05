import { z } from 'zod'

import { MAX_PASSKEY_LABEL } from '../limits.ts'
import { dateTimeSchema, idSchema, nonEmptyText } from './common.ts'

/**
 * One base64url field of a ceremony response.
 *
 * Bounded for the ordinary reasons — body size, log volume — and not as a
 * security property: what makes a response trustworthy is the signature over it,
 * which the backend checks. `attestationObject` is the long one, and with
 * `attestationType: 'none'` it is a few hundred bytes rather than a certificate
 * chain.
 */
const ceremonyField = z.string().min(1).max(16_384)

/**
 * What the browser hands back at the end of a ceremony.
 *
 * Mirrored from `@simplewebauthn`'s `RegistrationResponseJSON` and
 * `AuthenticationResponseJSON` rather than imported from them. This package is
 * the HTTP boundary and has to validate what arrives at it, `apps/web` may not
 * import Zod, and the mirror cannot silently drift: the backend passes the parsed
 * value straight into `verifyRegistrationResponse`, whose parameter *is* the
 * library's type, so a mismatch is a type error at that call.
 *
 * `transports` is `string[]` rather than the library's union deliberately. It is
 * a hint about how to reach an authenticator, and a device reporting a transport
 * the union predates would otherwise have its registration refused over it. The
 * route narrows the known ones out with a type guard before storing them.
 */
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

/** What a member calls one of theirs, so the list is possible to act on. */
export const passkeyLabelSchema = nonEmptyText(MAX_PASSKEY_LABEL)

/**
 * A registered passkey, as its owner sees it.
 *
 * No credential id and no public key: neither is a secret, and neither is
 * anything a member can do something with. What a list has to answer is which
 * device this is and whether it is still in use.
 */
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
