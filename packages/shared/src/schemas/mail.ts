import { z } from 'zod'

import { MAX_EMAIL, MAX_FROM_NAME, MAX_SMTP_HOST, MAX_SMTP_PASSWORD, MAX_SMTP_USERNAME } from '../limits.ts'
import { dateTimeSchema } from './common.ts'

/**
 * Where this installation posts from (#30).
 *
 * In the database and set by an admin, not in the environment — the same argument
 * the VAPID pair makes: `docker compose up` has to stay sufficient, and an
 * installation that never wants email never configures one. Nothing here is
 * required to boot and nothing fails without it.
 *
 * There is no hosted service behind this and no account to sign up for. It is
 * whatever SMTP the people running the gathering already have.
 */
export const mailSettingsFields = z.object({
  host: z.string().trim().min(1).max(MAX_SMTP_HOST),
  port: z.int().min(1).max(65_535),
  /**
   * Implicit TLS from the first byte, which is port 465.
   *
   * The other two ordinary ports, 587 and 25, open in the clear and upgrade with
   * STARTTLS — which the client does on its own when the server offers it. So this
   * is not "use TLS"; it is "the socket is TLS before anything is said".
   */
  secure: z.boolean(),
  /** Empty for a relay that authenticates by network rather than by password. */
  username: z.string().trim().max(MAX_SMTP_USERNAME),
  /** What the envelope and the `From:` header say. */
  from_email: z.email().max(MAX_EMAIL),
  /** The name beside it. Empty falls back to what the installation calls itself. */
  from_name: z.string().trim().max(MAX_FROM_NAME),
})

/**
 * What an admin reads back. **Never the password.**
 *
 * `has_password` rather than the value or a row of asterisks: the form has to say
 * whether one is stored, and a masked value invites a save that writes the mask.
 */
export const mailSettingsSchema = mailSettingsFields.extend({
  has_password: z.boolean(),
  updated_at: dateTimeSchema,
})
export type MailSettings = z.infer<typeof mailSettingsSchema>

/**
 * Setting it up, or changing it.
 *
 * `password` is optional and that is the whole of how a password is kept across an
 * edit: absent means leave what is stored, an empty string means clear it. A form
 * that had to re-type the password to change the port would end up with the password
 * in a text input on every visit.
 */
export const mailSettingsUpdateSchema = mailSettingsFields
  .extend({ password: z.string().max(MAX_SMTP_PASSWORD).optional() })
  .strict()
export type MailSettingsUpdate = z.infer<typeof mailSettingsUpdateSchema>

/** Null when nobody has set one up, which is the ordinary case. */
export const mailSettingsResponseSchema = z.object({ mail: mailSettingsSchema.nullable() })
export type MailSettingsResponse = z.infer<typeof mailSettingsResponseSchema>

/**
 * Whether a test message got out, and what the server said if it did not.
 *
 * The reason is passed through rather than flattened to "failed": an SMTP refusal
 * names the problem — bad credentials, a relay that will not take that sender, a
 * port nothing is listening on — and hiding that leaves an admin guessing at
 * somebody else's server.
 */
export const mailTestResponseSchema = z.object({
  sent: z.boolean(),
  to: z.email(),
  reason: z.string().nullable(),
})
export type MailTestResponse = z.infer<typeof mailTestResponseSchema>
