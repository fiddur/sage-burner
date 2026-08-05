import { z } from 'zod'

import { accountRoles } from '../enums.ts'
import { idSchema } from './common.ts'

/**
 * The email as stored and compared: lowercase, trimmed.
 *
 * Normalised in the schema rather than at each call site, because the account
 * table's UNIQUE uses BINARY collation — so `Admin@x.org` and `admin@x.org`
 * would otherwise become two accounts for one human, each with its own roles
 * and memberships. The CHECK constraint in the database catches a wrong *write*
 * but cannot fix a wrong *lookup*, which is the half that silently fails login.
 */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254))

/**
 * A password at login, not at registration.
 *
 * Deliberately only bounded, never pattern-checked: rejecting an existing
 * password at the login form because it fails a rule added later locks the
 * owner out of their own account. Registration is where strength rules belong,
 * and that arrives with invite redemption (#17).
 *
 * The upper bound is *not* a CPU guard, which is what this comment used to
 * claim. scrypt's cost is set by N and r; the password itself only feeds a
 * single PBKDF2-HMAC-SHA256 pass. Measured: 8 bytes 217ms, 1 KiB 216ms, 64 KiB
 * 220ms — indistinguishable. The bound is there for the ordinary reasons — body
 * size, log volume, not handing unbounded input to a crypto primitive — and 1024
 * is far above any real passphrase.
 */
export const loginPasswordSchema = z.string().min(1).max(1024)

/**
 * A password being set, with no quality rule beyond existing.
 *
 * Length minimums are the app deciding what a good password is on someone else's
 * behalf, and they push people towards the one they already reuse. Fredrik's
 * call: that is the member's business. `min(1)` only because a blank password is
 * not a password, and the max is a storage bound rather than a judgement.
 *
 * Identical to `loginPasswordSchema` today and still separate on purpose: a rule
 * added here must never reach login, where it would lock out everyone whose
 * existing password no longer passes.
 */
export const newPasswordSchema = z.string().min(1).max(1024)

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: loginPasswordSchema,
})
export type LoginRequest = z.infer<typeof loginRequestSchema>

/**
 * Who the caller is, as far as the browser needs to know.
 *
 * No email, no timestamps: the frontend renders navigation from `roles` and
 * nothing else, and every extra field here is one more thing an XSS would find
 * already fetched. The member's own record is a separate authorised read.
 */
export const viewerSchema = z.object({
  account_id: idSchema,
  roles: z.array(z.enum(accountRoles)),
  /**
   * The display name, for the initials in the corner — null on an account nobody
   * has filled in yet, including the bootstrap admin.
   *
   * The one personal field here, and deliberately the mildest: it is what every
   * other member already sees on the Members page and on any dream this person
   * hosts. The email stays out; that is the login identity.
   */
  name: z.string().nullable(),
  /**
   * When their picture last changed, or null for the initials.
   *
   * A version rather than a flag: it is what the circle's URL carries, so a new
   * picture is a new URL and no cache has to be persuaded to let go of the old one.
   * Null also spares every initials-only account a request that would 404.
   */
  avatar: z.string().nullable(),
})
export type Viewer = z.infer<typeof viewerSchema>

/**
 * `GET /api/auth/me` when nobody is signed in.
 *
 * A 200 with `{ viewer: null }` rather than a 401, because "not signed in" is
 * the expected answer for an anonymous visitor loading the public homepage —
 * not an error, and not something the client should surface as one.
 */
export const meResponseSchema = z.object({
  viewer: viewerSchema.nullable(),
})
export type MeResponse = z.infer<typeof meResponseSchema>
