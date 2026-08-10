import { INTRODUCTION_EXCERPT, mentionToken } from '@sage-burner/shared'
import { describe, expect, it } from 'vitest'

import { excerptOf } from './threads.ts'

describe('cutting an introduction down to a card', () => {
  it('leaves a short one whole, and an empty one as nothing at all', () => {
    expect(excerptOf('I build saunas.')).toBe('I build saunas.')
    expect(excerptOf('   ')).toBeNull()
    expect(excerptOf(null)).toBeNull()
  })

  it('cuts a long one on a word, with an ellipsis', () => {
    const cut = excerptOf(`${'word '.repeat(200)}end`)

    expect(cut?.length).toBeLessThanOrEqual(INTRODUCTION_EXCERPT + 1)
    expect(cut?.endsWith('…')).toBe(true)
    expect(cut?.endsWith('wor…')).toBe(false)
  })

  it('cuts on a line break too, which a written-out list is all of', () => {
    // Breaking on `' '` alone found none in a list of one-word lines, so it fell back to the
    // hard cut and split the word the cut landed in (#449).
    const cut = excerptOf('abcdefghij\n'.repeat(30))

    expect(cut?.endsWith('abcdefghij…')).toBe(true)
  })

  it('never cuts inside a mention, which would leave the raw token on the card', () => {
    const token = mentionToken('Ada', 'a0000000-0000-4000-8000-000000000001')
    const cut = excerptOf(`${'x'.repeat(INTRODUCTION_EXCERPT - 10)}${token} and more`)

    expect(cut).not.toContain('@[')
    expect(cut?.endsWith('…')).toBe(true)
  })

  it('keeps a mention that fits whole', () => {
    const token = mentionToken('Ada', 'a0000000-0000-4000-8000-000000000001')

    expect(excerptOf(`hello ${token}`)).toContain(token)
  })

  it('never cuts a character in half', () => {
    // A hard cut landing between the halves of a surrogate pair renders as a replacement
    // character, which is worse than one emoji fewer.
    const cut = excerptOf(`${'x'.repeat(INTRODUCTION_EXCERPT - 1)}🔥more`)

    expect(cut).not.toContain('�')
    expect([...(cut ?? '')].every((character) => character.codePointAt(0) !== 0xd8_3d)).toBe(true)
  })
})
