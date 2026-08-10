import { describe, expect, it } from 'vitest'

import {
  everybodyToken,
  MAX_MENTION_NAME,
  MENTION_EVERYBODY,
  mentionedAccounts,
  mentionName,
  mentionsAsLinks,
  mentionsEverybody,
  mentionsIn,
  mentionToken,
  withMentionNames,
} from './mentions.ts'

describe('what a mention is', () => {
  it('carries the id, so two people of one name are two mentions', () => {
    const body = `hello ${mentionToken('Ada', 'a-1')} and ${mentionToken('Ada', 'a-2')}`

    expect(mentionedAccounts(body)).toEqual(['a-1', 'a-2'])
  })

  it('is counted once however many times it is written', () => {
    const body = `${mentionToken('Ada', 'a-1')} ${mentionToken('Ada', 'a-1')}`

    expect(mentionedAccounts(body)).toEqual(['a-1'])
  })

  it('finds none in prose that only looks like one', () => {
    expect(
      mentionedAccounts('email me at ada@example.org, or @ada, or @[Ada](https://evil.example)'),
    ).toEqual([])
    expect(mentionsEverybody('@everybody')).toBe(false)
  })

  it('tells the whole burn apart from one person', () => {
    expect(mentionsEverybody(everybodyToken())).toBe(true)
    expect(mentionedAccounts(everybodyToken())).toEqual([])
    expect(mentionsEverybody(mentionToken('Ada', 'a-1'))).toBe(false)
  })

  it('keeps the name that was written, for when the account has gone', () => {
    expect(mentionsIn(mentionToken('Ada', 'a-1'))).toEqual([{ name: 'Ada', target: 'a-1' }])
  })
})

describe('a name inside a token', () => {
  it('cannot end the token early and put the rest of itself outside', () => {
    const token = mentionToken('x](javascript:alert(1))[y', 'a-1')
    const [found] = mentionsIn(token)

    expect(found?.target).toBe('a-1')
    expect(found?.name).not.toMatch(/[[\]()]/u)
    expect(mentionsAsLinks(token)).toBe(`[@${found?.name ?? ''}](/members/a-1)`)
    expect(mentionsAsLinks(token)).not.toContain('javascript:alert(1)')
  })

  it('cannot run to another line', () => {
    expect(mentionName('Ada\nLovelace')).toBe('Ada Lovelace')
  })

  it('is bounded, since it is written by whoever is typing', () => {
    expect(mentionName('a'.repeat(MAX_MENTION_NAME + 10))).toHaveLength(MAX_MENTION_NAME)
  })
})

describe('the name a mention shows', () => {
  it('is whoever the reader can resolve, not whoever was typed', () => {
    const said = withMentionNames(mentionToken('Ada', 'a-1'), () => 'Ada B')

    expect(mentionsIn(said)).toEqual([{ name: 'Ada B', target: 'a-1' }])
  })

  it('falls back to what was typed when nobody can be resolved', () => {
    const token = mentionToken('Ada', 'a-1')

    expect(withMentionNames(token, () => undefined)).toBe(token)
  })

  it('leaves the whole burn alone, which is nobody to resolve', () => {
    expect(withMentionNames(everybodyToken(), () => 'Ada')).toBe(everybodyToken())
  })
})

describe('rendering a mention', () => {
  it('becomes a link to the person, which the renderer escapes like any other', () => {
    expect(mentionsAsLinks(`hi ${mentionToken('Ada', 'a-1')}`)).toBe('hi [@Ada](/members/a-1)')
  })

  it('becomes no link for the whole burn, since there is no page for it', () => {
    expect(mentionsAsLinks(everybodyToken())).toBe(`**@${MENTION_EVERYBODY}**`)
  })

  it('leaves prose that is not a mention exactly as it was', () => {
    const prose = 'ada@example.org said `@[x](mention:y)` is the shape'

    expect(mentionsAsLinks('ada@example.org and @ada')).toBe('ada@example.org and @ada')
    // Inside backticks is still rewritten: the renderer, not this, decides what is code.
    expect(mentionsAsLinks(prose)).toContain('[@x](/members/y)')
  })
})
