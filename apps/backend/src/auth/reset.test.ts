import { RESET_VALID_HOURS } from '@sage-burner/shared'
import { describe, expect, it } from 'vitest'

import { resetExpiry, resetStatusOf } from './reset.ts'

const NOW = new Date('2026-08-18T09:00:00.000Z')

describe('how long a reset link lasts', () => {
  it('runs out the stated number of hours after it was minted', () => {
    expect(resetExpiry(NOW)).toBe('2026-08-18T11:00:00.000Z')
    expect(RESET_VALID_HOURS).toBe(2)
  })
})

describe('what a reset link is worth', () => {
  it('calls a link nobody minted unknown, rather than expired', () => {
    expect(resetStatusOf(undefined, NOW)).toBe('unknown')
  })

  it('holds a link right up to its expiry', () => {
    expect(resetStatusOf({ expires_at: '2026-08-18T09:00:00.001Z' }, NOW)).toBe('outstanding')
  })

  it('lets one go the instant it is reached, a link on its expiry being spent', () => {
    expect(resetStatusOf({ expires_at: NOW.toISOString() }, NOW)).toBe('expired')
  })
})
