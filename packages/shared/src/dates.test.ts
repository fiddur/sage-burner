import { describe, expect, it } from 'vitest'

import { dayName } from './dates.ts'

describe('naming a calendar day', () => {
  it('names the day the burn calls it', () => {
    expect(dayName('2026-10-03')).toBe('Saturday 3')
    expect(dayName('2026-10-03', 'short')).toBe('Sat 3')
    expect(dayName('2026-10-04')).toBe('Sunday 4')
  })

  it('gives back what it was handed when that is not a date', () => {
    expect(dayName('not a date')).toBe('not a date')
  })
})
