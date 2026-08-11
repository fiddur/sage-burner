import { describe, expect, it } from 'vitest'

import { hasMarkdown, LINK_PLACEHOLDER, written } from './syntax.ts'

const at = (value: string, start: number, end = start) => ({ start, end })

describe('writing bold', () => {
  it('wraps what is selected and keeps the selection on the words', () => {
    const result = written('bold', 'a warm sauna', at('', 7, 12))

    expect(result.value).toBe('a warm **sauna**')
    expect(result.value.slice(result.start, result.end)).toBe('sauna')
  })

  it('opens an empty pair with the caret inside it when nothing is selected', () => {
    const result = written('bold', 'a warm ', at('', 7))

    expect(result.value).toBe('a warm ****')
    expect(result.start).toBe(9)
    expect(result.end).toBe(9)
  })

  it('takes it off again when what is selected is already wrapped', () => {
    const result = written('bold', 'a warm **sauna**', at('', 9, 14))

    expect(result.value).toBe('a warm sauna')
    expect(result.value.slice(result.start, result.end)).toBe('sauna')
  })

  it('wraps a selection at the very start, where there is nothing before it to read', () => {
    // `slice` with a negative start reads from the end of the string, so the unwrap check
    // has to refuse the boundary rather than ask what is before the first character.
    expect(written('bold', 'sauna', at('', 0, 5)).value).toBe('**sauna**')
  })

  it('refuses when the markers would not fit, which the field cannot refuse for it', () => {
    // `maxlength` does not apply to a programmatic insert — the #457 rule.
    const value = 'x'.repeat(19)

    expect(written('bold', value, at('', 0, 19), 20).value).toBe(value)
  })

  it('wraps at the same length where there is room, which is what makes it a bound', () => {
    const value = 'x'.repeat(16)

    expect(written('bold', value, at('', 0, 16), 20).value).toBe(`**${value}**`)
  })
})

describe('writing italic', () => {
  it('wraps in underscores', () => {
    expect(written('italic', 'a warm sauna', at('', 7, 12)).value).toBe('a warm _sauna_')
  })

  it('leaves bold alone rather than reading its asterisks as its own marker', () => {
    expect(written('italic', '**sauna**', at('', 2, 7)).value).toBe('**_sauna_**')
  })

  it('takes itself off again', () => {
    expect(written('italic', '_sauna_', at('', 1, 6)).value).toBe('sauna')
  })
})

describe('writing a link', () => {
  it('makes what is selected the words, and selects the address so typing replaces it', () => {
    const result = written('link', 'see the map', at('', 8, 11))

    expect(result.value).toBe(`see the [map](${LINK_PLACEHOLDER})`)
    expect(result.value.slice(result.start, result.end)).toBe(LINK_PLACEHOLDER)
  })

  it('writes an empty pair of words when nothing is selected', () => {
    expect(written('link', '', at('', 0)).value).toBe(`[](${LINK_PLACEHOLDER})`)
  })

  it('refuses when it would not fit', () => {
    expect(written('link', 'map', at('', 0, 3), 10).value).toBe('map')
  })
})

describe('writing a list', () => {
  it('bullets the line the caret is on', () => {
    expect(written('list', 'bring a cup', at('', 5)).value).toBe('- bring a cup')
  })

  it('bullets every line the selection touches', () => {
    expect(written('list', 'a cup\na plate\na spoon', at('', 2, 9)).value).toBe('- a cup\n- a plate\na spoon')
  })

  it('takes the bullets off again when every line already has one', () => {
    expect(written('list', '- a cup\n- a plate', at('', 2, 9)).value).toBe('a cup\na plate')
  })

  it('finishes the list rather than unmaking it when only some lines have one', () => {
    expect(written('list', '- a cup\na plate', at('', 2, 9)).value).toBe('- - a cup\n- a plate')
  })

  it('refuses when the bullets would not fit', () => {
    const value = 'a cup\na plate'

    expect(written('list', value, at('', 0, value.length), value.length + 3).value).toBe(value)
  })
})

describe('whether there is any markdown in what somebody wrote', () => {
  it('says no to plain words, which is most of what members write', () => {
    expect(hasMarkdown('Bringing a big pot and two ladles. See you Friday!')).toBe(false)
  })

  it('says no to an asterisk or an underscore that marks nothing', () => {
    expect(hasMarkdown('2 * 3 is 6')).toBe(false)
    expect(hasMarkdown('the file is called sauna_at_dawn')).toBe(false)
  })

  for (const [what, value] of [
    ['bold', 'a **warm** sauna'],
    ['italic', 'a _warm_ sauna'],
    ['a link', 'see [the map](https://example.org)'],
    ['a picture', 'look ![](/api/images/x)'],
    ['a heading', '# Sauna'],
    ['a bulleted list', '- a cup\n- a plate'],
    ['a numbered list', '1. a cup'],
    ['a quote', '> as Ada said'],
    ['code', 'run `pnpm check`'],
  ] as const) {
    it(`says yes to ${what}`, () => {
      expect(hasMarkdown(value)).toBe(true)
    })
  }
})
