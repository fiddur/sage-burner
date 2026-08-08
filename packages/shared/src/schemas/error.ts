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
 * `stale` and `precondition_required` are the two halves of `If-Match` (#274) and
 * are deliberately distinct from `conflict`: a 409 means the request cannot be
 * satisfied at all — the burn is full — while these mean it was written against a
 * version that has moved on, and doing it again over the fresh one would work.
 * Their responses carry the current representation beside the code, which is what
 * lets the page show what the other person wrote.
 *
 * `not_approved` and `invite_used` are the two ways reissuing an invite is refused
 * (#178). Both are 409 and they mean opposite things to whoever is reading the page —
 * "this application has not been approved" against "they are already in" — and a
 * single `conflict` left the page wording every refusal as the second. That was honest
 * only because `approved` is terminal and the button renders on approved rows alone,
 * so the first was unreachable through the UI; two load-bearing facts nothing wrote
 * down, and both would go the day an un-approve path arrives.
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
  'stale',
  'precondition_required',
  'not_approved',
  'invite_used',
] as const
export type ErrorCode = (typeof errorCodes)[number]

/** Build the body for a given code. The single place the envelope is constructed. */
export const errorResponse = (error: ErrorCode): ErrorResponse => ({ error })
