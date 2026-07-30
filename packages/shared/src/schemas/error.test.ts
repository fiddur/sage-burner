import { describe, expect, it } from 'vitest'

import { errorCodes, errorResponse, errorResponseSchema } from './error.ts'

/**
 * These pin the wire format itself.
 *
 * The backend's route tests deliberately assert the literal `{ error: '…' }`
 * rather than calling `errorResponse`, so they would catch the envelope
 * changing shape. This file is where the shape is stated once.
 */

describe('errorResponse', () => {
  it('produces exactly the wire shape the frontend parses', () => {
    expect(errorResponse('not_found')).toEqual({ error: 'not_found' })
  })

  it('carries only the code — nothing that could leak internals', () => {
    // A message, a stack, or a path here would end up in front of a member and
    // in every log that records a response body.
    for (const code of errorCodes) {
      expect(Object.keys(errorResponse(code))).toEqual(['error'])
    }
  })

  it('parses as its own schema', () => {
    for (const code of errorCodes) {
      expect(errorResponseSchema.safeParse(errorResponse(code)).success).toBe(true)
    }
  })
})

describe('errorResponseSchema', () => {
  it('rejects a body with no error code', () => {
    expect(errorResponseSchema.safeParse({}).success).toBe(false)
  })

  it('rejects a non-string code, which is what a serialised Error would give', () => {
    expect(errorResponseSchema.safeParse({ error: { message: 'nope' } }).success).toBe(false)
    expect(errorResponseSchema.safeParse({ error: 500 }).success).toBe(false)
  })

  it('accepts a code outside the vocabulary, so an older client can still parse a newer API', () => {
    expect(errorResponseSchema.safeParse({ error: 'some_future_code' }).success).toBe(true)
  })
})
