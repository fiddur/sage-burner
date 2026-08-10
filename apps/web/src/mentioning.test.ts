import { MENTION_EVERYBODY, mentionsIn, mentionToken } from '@sage-burner/shared'
import { describe, expect, it } from 'vitest'

import { candidatesFor, fragmentAt, withMentionAt } from './mentioning.ts'

const PEOPLE = [
  { account_id: 'a-1', name: 'Ada' },
  { account_id: 'a-2', name: 'Adam' },
  { account_id: 'a-3', name: 'Bea' },
  { account_id: 'a-4', name: null },
]

describe('what is being typed after an @', () => {
  it('is the word the caret is inside', () => {
    expect(fragmentAt('hello @ad', 9)).toBe('ad')
    expect(fragmentAt('@ad', 3)).toBe('ad')
  })

  it('is nothing before an @ has been typed', () => {
    expect(fragmentAt('hello', 5)).toBeUndefined()
  })

  it('is empty right after the @, which offers everybody', () => {
    expect(fragmentAt('hi @', 4)).toBe('')
  })

  it('ends at a space, so a finished word is not still being typed', () => {
    expect(fragmentAt('@ada and then', 13)).toBeUndefined()
  })

  it('is nothing in an email address, which is the common false positive', () => {
    expect(fragmentAt('write to ada@example.org', 24)).toBeUndefined()
  })

  it('is nothing inside a token already placed', () => {
    const body = `${mentionToken('Ada', 'a-1')} `

    expect(fragmentAt(body, body.length)).toBeUndefined()
  })
})

describe('who is offered', () => {
  it('is whoever the name starts with, and never somebody with no name', () => {
    expect(candidatesFor('ad', PEOPLE).map((one) => one.name)).toEqual(['Ada', 'Adam'])
  })

  it('offers the whole burn as well, which is not an account', () => {
    expect(candidatesFor('', PEOPLE)[0]).toEqual({
      target: MENTION_EVERYBODY,
      name: MENTION_EVERYBODY,
    })
  })

  it('offers nobody for a fragment that matches nothing, rather than everybody', () => {
    expect(candidatesFor('zz', PEOPLE)).toEqual([])
  })
})

describe('picking somebody', () => {
  it('replaces what was typed with a token carrying the id', () => {
    const { value, caret } = withMentionAt('hi @ad', 6, { target: 'a-1', name: 'Ada' })

    expect(mentionsIn(value)).toEqual([{ name: 'Ada', target: 'a-1' }])
    expect(value.startsWith('hi ')).toBe(true)
    expect(value.endsWith(' ')).toBe(true)
    expect(caret).toBe(value.length)
  })

  it('leaves what came after the caret where it was', () => {
    const { value } = withMentionAt('hi @ad, are you in?', 6, { target: 'a-1', name: 'Ada' })

    expect(value.endsWith(', are you in?')).toBe(true)
  })

  it('does nothing when the caret is not in a mention', () => {
    expect(withMentionAt('hello', 5, { target: 'a-1', name: 'Ada' })).toEqual({ value: 'hello', caret: 5 })
  })
})
