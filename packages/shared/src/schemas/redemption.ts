import { z } from 'zod'

import { inviteStatuses } from '../enums.ts'
import { emailSchema, newPasswordSchema } from './auth.ts'
import { nonEmptyText, optionalText } from './common.ts'

/**
 * What a visitor may do with an invite before it is spent.
 *
 * The token is never echoed back, and neither is anything about who it was minted
 * for: an invite link is unguessable but forwardable, so whoever holds it is
 * treated as a stranger until they redeem it. Telling them "this was for
 * fredrik@example.org" would turn a leaked link into a disclosure.
 */
export const inviteStateSchema = z.object({
  // Derived from `inviteStatuses` rather than a second list of the same words,
  // plus the one state only this route has: a token nobody minted. `unknown` is
  // reported as a status rather than a 404 so probing for live tokens gets the
  // same answer shape as holding one.
  status: z.enum([...inviteStatuses, 'unknown']),
})

/**
 * Redeeming: become an account, and say who you are.
 *
 * One request rather than two, because a half-finished redemption is the worst
 * outcome — the token is spent and the person has no way to finish. So the
 * account, the person-level details and the `used_at` stamp are one transaction.
 *
 * `.strict()` for the reason the other create schemas give: an unrecognised key
 * is a 400 rather than a silent success.
 */
export const redeemRequestSchema = z
  .object({
    email: emailSchema,
    password: newPasswordSchema,
    name: nonEmptyText(200),
    /**
     * How to reach them beyond the email they just gave.
     *
     * Optional, because asking "how can we reach you?" on the form where someone
     * has just typed their email reads as a question already answered. The
     * account falls back to the email when this is empty, so the field is never
     * blank for whoever is doing the planning.
     */
    // `.optional()` as well as nullable: `optionalText` allows an explicit null
    // but still requires the key, and the point here is a form that never asks.
    contact: optionalText(500).optional(),
    allergies_notes: optionalText(2000),
  })
  .strict()

export type InviteState = z.infer<typeof inviteStateSchema>
export type RedeemRequest = z.infer<typeof redeemRequestSchema>

/**
 * What a *client* may send. `contact` is optional here and present-but-nullable
 * in the parsed result, which is the same split as `EventCreateInput`.
 */
export type RedeemRequestInput = z.input<typeof redeemRequestSchema>
