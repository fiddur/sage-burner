import { z } from 'zod'

/**
 * The shape every non-2xx API response takes.
 *
 * Lives here rather than in the backend because it crosses the API boundary:
 * the web app parses it, and the alternative is what this replaced — one
 * literal in `app.ts` and four more in its tests, with the tests quietly
 * becoming the definition.
 *
 * `error` carries a machine-readable slug, never a sentence. It is the thing a
 * caller branches on; the message a member reads is the frontend's to choose,
 * since only the frontend knows the context the failure happened in.
 */
export const errorResponseSchema = z.object({
  error: z.string(),
})

export type ErrorResponse = z.infer<typeof errorResponseSchema>

/**
 * Error codes the API can return.
 *
 * Only what the app actually emits today. It grows alongside the routes that
 * emit it, rather than listing values first and leaving unreachable ones.
 *
 * `invalid_credentials` is deliberately one code for both a wrong password and
 * an unknown email — telling those apart is an account enumeration oracle.
 * `rate_limited` exists because 429 would otherwise be indistinguishable from a
 * malformed body, and a client that cannot tell them apart cannot say "try
 * again shortly".
 *
 * `unauthenticated` and `forbidden` are separate codes because 401 and 403 are
 * the distinction a client cannot safely collapse: 401 means signing in would
 * help, 403 means it would not. Both are emitted by the admin guard.
 *
 * `errorResponseSchema` deliberately accepts codes outside this list, so an
 * older client can still parse a newer API's response rather than failing to
 * read the error explaining what went wrong.
 */
export const errorCodes = [
  'bad_request',
  'not_found',
  'internal_error',
  'invalid_credentials',
  'unauthenticated',
  'forbidden',
  'conflict',
  'rate_limited',
] as const
export type ErrorCode = (typeof errorCodes)[number]

/** Build the body for a given code. The single place the envelope is constructed. */
export const errorResponse = (error: ErrorCode): ErrorResponse => ({ error })
