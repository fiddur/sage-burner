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
 * Only what the app actually emits today: the 404 handler, and the error
 * handler that maps everything else onto this envelope. It grows alongside the
 * routes that emit it — #8 adds the auth codes when there are auth routes to
 * return them, rather than listing them first and leaving unreachable values
 * and an argument about type safety that nothing yet exercises.
 *
 * `errorResponseSchema` deliberately accepts codes outside this list, so an
 * older client can still parse a newer API's response rather than failing to
 * read the error explaining what went wrong.
 */
export const errorCodes = ['bad_request', 'not_found', 'internal_error'] as const
export type ErrorCode = (typeof errorCodes)[number]

/** Build the body for a given code. The single place the envelope is constructed. */
export const errorResponse = (error: ErrorCode): ErrorResponse => ({ error })
