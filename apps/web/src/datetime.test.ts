import { describe, expect, it } from 'vitest'

import { fromLocalInput, toLocalInput } from './datetime.ts'

describe('datetime-local conversion', () => {
  it('round-trips an instant through the input and back', () => {
    const iso = '2026-08-02T18:00:00.000Z'

    expect(fromLocalInput(toLocalInput(iso))).toBe(iso)
  })

  it('shows the local wall clock, not the UTC one', () => {
    // A literal, which is only safe because `vite.config.ts` pins the suite to
    // Europe/Stockholm. In UTC every wrong implementation looks right here, so
    // running this suite in UTC would silently stop testing anything.
    expect(toLocalInput('2026-08-02T18:00:00.000Z')).toBe('2026-08-02T20:00')
    expect(fromLocalInput('2026-08-02T20:00')).toBe('2026-08-02T18:00:00.000Z')
  })

  it('produces exactly the shape the input accepts', () => {
    expect(toLocalInput('2026-08-02T18:00:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })

  it('is not a substring of the ISO text, which is the tempting shortcut', () => {
    const iso = '2026-08-02T18:00:00.000Z'

    expect(toLocalInput(iso)).not.toBe(iso.slice(0, 16))
  })

  it('treats an empty box as no time at all', () => {
    expect(fromLocalInput('')).toBeNull()
    expect(fromLocalInput('   ')).toBeNull()
    expect(toLocalInput(null)).toBe('')
  })

  it('does not turn nonsense into an instant', () => {
    expect(fromLocalInput('not a date')).toBeNull()
    expect(toLocalInput('not a date')).toBe('')
  })
})
