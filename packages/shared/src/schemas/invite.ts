import { z } from 'zod'

import { MAX_APPLICANT_NAME_LENGTH } from '../answers.ts'
import { inviteStatuses } from '../enums.ts'
import { dateTimeSchema, idSchema } from './common.ts'

/**
 * An invite as an admin sees it — never the token.
 *
 * Only the digest is stored, so there is nothing to show here even if it were
 * wanted: the raw value existed in the one response that minted it. `status` is
 * derived from the clock by `inviteStatusOf` rather than stored.
 */
export const adminInviteSchema = z.object({
  id: idSchema,
  /** Null for a direct invite, which is what makes it revocable. */
  application_id: idSchema.nullable(),
  // Bounded like the column it comes from. The one unbounded string in the schema
  // set until now, and it is copied straight out of `application.applicant_name`.
  applicant_name: z.string().max(MAX_APPLICANT_NAME_LENGTH).nullable(),
  expires_at: dateTimeSchema,
  used_at: dateTimeSchema.nullable(),
  status: z.enum(inviteStatuses),
})

export const adminInvitesResponseSchema = z.object({ invites: z.array(adminInviteSchema) })

/**
 * Minting a direct invite. `expires_at` is optional; the route applies the same
 * default an approval uses.
 *
 * `.default({})` because every field is optional and a `POST` with no body at all is
 * the ordinary case — "give me a link with the usual expiry". The route read
 * `request.body ?? {}` for that, which was the last `safeParse` outside login; the
 * rule belongs on the schema, where a reader of the shape can see it (#272).
 */
export const inviteCreateSchema = z.object({ expires_at: dateTimeSchema.optional() }).strict().default({})

export type AdminInvite = z.infer<typeof adminInviteSchema>
export type AdminInvitesResponse = z.infer<typeof adminInvitesResponseSchema>
export type InviteCreate = z.infer<typeof inviteCreateSchema>
