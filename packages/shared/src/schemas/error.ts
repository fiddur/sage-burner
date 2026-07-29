import { z } from 'zod'

/**
 * The shape every non-2xx API response takes.
 *
 * Lives here rather than in the backend because the web app has to handle it —
 * and because the alternative is what it replaced: one literal in `app.ts` and
 * four more in its tests, with the tests quietly becoming the definition.
 *
 * `code` is a machine-readable slug, never a sentence. It is the thing a caller
 * branches on; the message a member reads is the frontend's to choose, since
 * only the frontend knows the context the failure happened in.
 */
export const errorResponseSchema = z.object({
  error: z.string(),
})

export type ErrorResponse = z.infer<typeof errorResponseSchema>

/**
 * Error codes the API can return.
 *
 * Kept as a vocabulary rather than free strings so the frontend can exhaustively
 * map the ones worth special-casing, and so a typo in a route is a type error
 * rather than a code nobody handles.
 */
export const errorCodes = ['not_found', 'unauthorized', 'forbidden', 'validation_failed'] as const
export type ErrorCode = (typeof errorCodes)[number]

export const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === 'string' && errorCodes.some((candidate) => candidate === value)

/** Build the body for a given code. The single place the envelope is constructed. */
export const errorResponse = (error: ErrorCode): ErrorResponse => ({ error })
