import { describe, expect, it } from 'vitest'

import { apiError } from './api/client.ts'
import { isStale, theirVersion } from './stale.ts'

const refused = (payload: unknown, status = 412) =>
  apiError(status, 'stale', 'Somebody else changed this.', payload)

describe('isStale', () => {
  it('takes both halves of the precondition, which read the same to a member', () => {
    expect(isStale(refused({}, 412))).toBe(true)
    expect(isStale(refused({}, 428))).toBe(true)
  })

  it('leaves every other failure alone', () => {
    expect(isStale(apiError(409, 'conflict', 'The burn is full.'))).toBe(false)
    expect(isStale(apiError(403, 'forbidden', 'No.'))).toBe(false)
    expect(isStale(new Error('something else'))).toBe(false)
    expect(isStale(undefined)).toBe(false)
  })
})

describe('theirVersion', () => {
  it('reads the field the page names, however deep', () => {
    expect(
      theirVersion(refused({ event: { welcome_markdown: 'theirs' } }), ['event', 'welcome_markdown']),
    ).toBe('theirs')
    expect(theirVersion(refused({ intro_markdown: 'bring a bowl' }), ['intro_markdown'])).toBe('bring a bowl')
  })

  it('answers nothing rather than guessing, when the payload is not that shape', () => {
    expect(theirVersion(refused(undefined), ['event', 'welcome_markdown'])).toBeUndefined()
    expect(theirVersion(refused({ error: 'stale' }), ['event', 'welcome_markdown'])).toBeUndefined()
    expect(theirVersion(refused({ event: null }), ['event', 'welcome_markdown'])).toBeUndefined()
    expect(theirVersion(refused({ places: [] }), ['places'])).toBeUndefined()
  })

  it('answers nothing for a failure that is not a refusal at all', () => {
    const other = apiError(500, 'internal_error', 'Oh dear', { event: { welcome_markdown: 'theirs' } })

    expect(theirVersion(other, ['event', 'welcome_markdown'])).toBeUndefined()
  })

  it('keeps an empty string, which is what clearing the field looks like', () => {
    expect(theirVersion(refused({ intro_markdown: '' }), ['intro_markdown'])).toBe('')
  })
})
