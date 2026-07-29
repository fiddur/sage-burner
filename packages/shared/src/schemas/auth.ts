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
 * owner out of their own account. The upper bound is a denial-of-service guard
 * — scrypt hashes whatever it is given, so an unbounded field lets one request
 * burn arbitrary CPU. Registration is where strength rules belong, and that
 * arrives with invite redemption (#17).
 */
export const loginPasswordSchema = z.string().min(1).max(1024)

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
