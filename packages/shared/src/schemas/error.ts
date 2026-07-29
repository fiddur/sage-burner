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
 * `unauthenticated` and `forbidden` are the distinction a client cannot make
 * from the status alone once both exist: "sign in" and "you are signed in and
 * still may not" need different copy, and `messageFor` in the web client keys
 * on status, which gives 401 and 403 different messages but gives every other
 * 4xx the same one. `invalid_credentials` is deliberately one code for both a
 * wrong password and an unknown email — telling those apart is an account
 * enumeration oracle.
 *
 * `errorResponseSchema` deliberately accepts codes outside this list, so an
 * older client can still parse a newer API's response rather than failing to
 * read the error explaining what went wrong.
 */
export const errorCodes = [
  'bad_request',
  'not_found',
  'internal_error',
  'unauthenticated',
  'forbidden',
  'invalid_credentials',
] as const
export type ErrorCode = (typeof errorCodes)[number]

/** Build the body for a given code. The single place the envelope is constructed. */
export const errorResponse = (error: ErrorCode): ErrorResponse => ({ error })
