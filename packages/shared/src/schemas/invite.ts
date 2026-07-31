import { z } from 'zod'

import { inviteStatuses } from '../enums.ts'
import { dateTimeSchema, idSchema } from './common.ts'

/**
 * An invite as an organiser sees it — never the token.
 *
 * Only the digest is stored, so there is nothing to show here even if it were
 * wanted: the raw value existed in the one response that minted it. `status` is
 * derived from the clock by `inviteStatusOf` rather than stored.
 */
export const adminInviteSchema = z.object({
  id: idSchema,
  /** Null for a direct invite, which is what makes it revocable. */
  application_id: idSchema.nullable(),
  applicant_name: z.string().nullable(),
  expires_at: dateTimeSchema,
  used_at: dateTimeSchema.nullable(),
  status: z.enum(inviteStatuses),
})

export const adminInvitesResponseSchema = z.object({ invites: z.array(adminInviteSchema) })

/** `expires_at` is optional; the route applies the same default an approval uses. */
export const inviteCreateSchema = z.object({ expires_at: dateTimeSchema.optional() }).strict()

export type AdminInvite = z.infer<typeof adminInviteSchema>
export type AdminInvitesResponse = z.infer<typeof adminInvitesResponseSchema>
export type InviteCreate = z.infer<typeof inviteCreateSchema>
