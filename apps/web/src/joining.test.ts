import { describe, expect, it } from 'vitest'

import { apiError } from './api/client.ts'
import { joinFirst, joinLink, NEEDS_JOINING, NEEDS_JOINING_THEM, notAttending } from './joining.ts'

const refused = apiError(400, 'not_attending', 'Request failed (400).')
const otherwise = apiError(409, 'conflict', 'Somebody got there first.')

describe('a refusal that is really an invitation to join', () => {
  it('turns the code into what to do about it, rather than the status', () => {
    expect(joinFirst('Could not save that.')(refused)).toBe(NEEDS_JOINING)
  })

  it('says it of whoever was being put on, when that was somebody else', () => {
    expect(joinFirst('Could not save that.', 'theirs')(refused)).toBe(NEEDS_JOINING_THEM)
  })

  it('offers the details page to go and do it on', () => {
    expect(joinLink(refused)).toEqual({ href: '/profile', label: 'Your details' })
  })

  it('leaves every other failure the message it came with', () => {
    expect(joinFirst('Could not save that.')(otherwise)).toBe('Somebody got there first.')
    expect(joinLink(otherwise)).toBeUndefined()
  })

  it('falls back for a failure that is not the API answering at all', () => {
    expect(joinFirst('Could not save that.')(new Error('offline'))).toBe('Could not save that.')
    expect(notAttending(new Error('offline'))).toBe(false)
    expect(joinLink(undefined)).toBeUndefined()
  })
})
