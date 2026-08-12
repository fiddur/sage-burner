import { z } from 'zod'

export const errorResponseSchema = z.object({
  error: z.string(),
})

export type ErrorResponse = z.infer<typeof errorResponseSchema>

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
  'list_full',
  'not_attending',
  'already_member',
  'already_applied',
] as const
export type ErrorCode = (typeof errorCodes)[number]

export const errorResponse = (error: ErrorCode): ErrorResponse => ({ error })
