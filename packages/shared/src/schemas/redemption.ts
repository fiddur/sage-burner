import { z } from 'zod'

import { inviteStatuses } from '../enums.ts'
import { MAX_CONTACT, MAX_NOTES, MAX_PERSON_NAME } from '../limits.ts'
import { emailSchema, meResponseSchema, newPasswordSchema } from './auth.ts'
import { idSchema, nonEmptyText, optionalText } from './common.ts'
import { attendanceSchema } from './membership.ts'

/**
 * What a visitor may do with an invite before it is spent.
 *
 * The token is never echoed back. What the applicant themselves typed is: their
 * **name** and, since #30, the **email** the invite was posted to — both only while
 * the invite is outstanding, so a spent or expired link discloses nothing.
 *
 * Both are the same trade. They filled these in on the application and are then asked
 * for them again on the form the invite leads to, which reads as a system that was
 * not listening — and once the invite arrives *by email*, asking the address it just
 * came to is worse than not listening. The cost is that a forwarded link tells its
 * holder whose invite it was, weighed against a token that is 256 bits of CSPRNG,
 * single-use and expiring, and only ever sent to the person it names.
 *
 * This is **not** an enumeration oracle, which is what the email was held back from
 * being: nothing here takes an address and says whether it has an application. It
 * takes a token nobody can guess and says what the person who applied wrote.
 */
export const inviteStateSchema = z.object({
  // Derived from `inviteStatuses` rather than a second list of the same words,
  // plus the one state only this route has: a token nobody minted. `unknown` is
  // reported as a status rather than a 404 so probing for live tokens gets the
  // same answer shape as holding one.
  status: z.enum([...inviteStatuses, 'unknown']),
  /** What they called themselves when they applied, for the form to start from. */
  name: z.string().nullable(),
  /**
   * The address they applied with, for the form to start from.
   *
   * Null for an admin's direct invite, which has no application behind it, and null
   * for a link that is no longer outstanding.
   */
  email: z.string().nullable(),
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
    /**
     * The burn they ticked on the form, if there was one to tick.
     *
     * Almost everybody spending an invite is joining the burn that is coming, so the
     * form offers it rather than leaving them to find their way to a second page
     * (#224). An id rather than a flag, so what the form named is what gets joined —
     * the server resolving "the upcoming one" a second time could pick a different
     * burn from the one somebody read.
     *
     * Failing to join never fails the redemption: the token is spent and cannot be
     * spent again, so a half-finished signup strands somebody with no way to finish.
     * The response says which happened.
     */
    join_event_id: idSchema.nullable().optional(),
  })
  .strict()

/**
 * What redeeming produced: the viewer, and the burn they joined if they joined one.
 *
 * `attendance` is null for an unticked box and for a burn that ended while the form
 * was open — the page tells those apart by whether it offered one, and says something
 * different for each.
 */
export const redeemResponseSchema = meResponseSchema.extend({
  attendance: attendanceSchema.nullable(),
})

export type InviteState = z.infer<typeof inviteStateSchema>
export type RedeemRequest = z.infer<typeof redeemRequestSchema>
export type RedeemResponse = z.infer<typeof redeemResponseSchema>

/**
 * What a *client* may send. `contact` is optional here and present-but-nullable
 * in the parsed result, which is the same split as `EventCreateInput`.
 */
export type RedeemRequestInput = z.input<typeof redeemRequestSchema>
