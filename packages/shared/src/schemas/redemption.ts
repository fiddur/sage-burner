import { z } from 'zod'

import { inviteStatuses } from '../enums.ts'
import { MAX_CONTACT, MAX_NOTES, MAX_PERSON_NAME } from '../limits.ts'
import { emailSchema, newPasswordSchema } from './auth.ts'
import { nonEmptyText, optionalText } from './common.ts'

/**
 * What a visitor may do with an invite before it is spent.
 *
 * The token is never echoed back, and the **email** never is either: it is the login
 * identity, and confirming that an address has an application is an enumeration
 * oracle. An invite link is unguessable but forwardable, so whoever holds it is
 * treated as a stranger until they redeem.
 *
 * The applicant's **name** is the one exception, and a deliberate trade: they typed
 * it on the application and are then asked for it again on the form the invite leads
 * to, which reads as a system that was not listening. Pre-filling it means a
 * forwarded link tells its holder whose invite it was — weighed against a token that
 * is 256 bits of CSPRNG, single-use and expiring, and a name that is not a
 * credential. Returned **only while the invite is outstanding**, so a spent or
 * expired link discloses nothing.
 */
export const inviteStateSchema = z.object({
  // Derived from `inviteStatuses` rather than a second list of the same words,
  // plus the one state only this route has: a token nobody minted. `unknown` is
  // reported as a status rather than a 404 so probing for live tokens gets the
  // same answer shape as holding one.
  status: z.enum([...inviteStatuses, 'unknown']),
  /** What they called themselves when they applied, for the form to start from. */
  name: z.string().nullable(),
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
    name: nonEmptyText(MAX_PERSON_NAME),
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
    contact: optionalText(MAX_CONTACT).optional(),
    allergies_notes: optionalText(MAX_NOTES),
  })
  .strict()

export type InviteState = z.infer<typeof inviteStateSchema>
export type RedeemRequest = z.infer<typeof redeemRequestSchema>

/**
 * What a *client* may send. `contact` is optional here and present-but-nullable
 * in the parsed result, which is the same split as `EventCreateInput`.
 */
export type RedeemRequestInput = z.input<typeof redeemRequestSchema>
