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
    // 409 in particular: the burn being full cannot be fixed by looking again, and
    // reloading over it would replace a true message with a misleading one.
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
    // Every one of these has been a real response at some point: a refusal with no
    // body, an envelope from a proxy, a field that is a list rather than a string.
    expect(theirVersion(refused(undefined), ['event', 'welcome_markdown'])).toBeUndefined()
    expect(theirVersion(refused({ error: 'stale' }), ['event', 'welcome_markdown'])).toBeUndefined()
    expect(theirVersion(refused({ event: null }), ['event', 'welcome_markdown'])).toBeUndefined()
    expect(theirVersion(refused({ places: [] }), ['places'])).toBeUndefined()
  })

  it('answers nothing for a failure that is not a refusal at all', () => {
    // The passing sibling above proves it reads the field; this proves it will not
    // read one off a 500 that happened to carry a body of the same shape.
    const other = apiError(500, 'internal_error', 'Oh dear', { event: { welcome_markdown: 'theirs' } })

    expect(theirVersion(other, ['event', 'welcome_markdown'])).toBeUndefined()
  })

  it('keeps an empty string, which is what clearing the field looks like', () => {
    expect(theirVersion(refused({ intro_markdown: '' }), ['intro_markdown'])).toBe('')
  })
})
