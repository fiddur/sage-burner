import { describe, expect, it } from 'vitest'

import type { Block } from './template.ts'

import { escapeHtml, htmlFrom, textFrom, WRAP_AT, wrapped } from './template.ts'

describe('wrapping the plain-text part', () => {
  it('fills to the width and no further', () => {
    const lines = wrapped('one two three four five', 13)

    expect(lines).toEqual(['one two three', 'four five'])
  })

  it('leaves a word longer than the width whole', () => {
    // Quoted-printable puts a soft wrap back; a URL split down the middle is a URL
    // nobody can click, so the one line that has to survive is never broken.
    const link = 'https://burn.example.org/invite/a-token-longer-than-any-sensible-width'

    expect(wrapped(link, 20)).toEqual([link])
  })

  it('keeps every line inside the width across a whole message', () => {
    const blocks: Block[] = [{ paragraph: 'a '.repeat(200).trim() }, { note: 'b '.repeat(200).trim() }]

    for (const line of textFrom(blocks).split('\n')) expect(line.length).toBeLessThanOrEqual(WRAP_AT)
  })
})

describe('what the plain-text part is made of', () => {
  it('puts a link on a line of its own', () => {
    const text = textFrom([{ paragraph: 'Follow it:' }, { action: { href: 'https://x/y', label: 'Go' } }])

    expect(text.split('\n')).toContain('https://x/y')
  })

  it('separates the notes at the foot with one rule, however many there are', () => {
    const text = textFrom([{ paragraph: 'Hello' }, { note: 'One.' }, { note: 'Two.' }])

    expect(text.split('\n').filter((line) => line === '--')).toHaveLength(1)
  })

  it('says nothing of a rule where there is no note', () => {
    expect(textFrom([{ paragraph: 'Hello' }]).split('\n')).not.toContain('--')
  })

  it('lists each line with what it points at underneath', () => {
    const text = textFrom([
      { lines: [{ text: 'Ada commented', href: 'https://x/1' }, { text: 'Bo did too' }] },
    ])

    expect(text.split('\n')).toEqual(['- Ada commented', '  https://x/1', '- Bo did too'])
  })
})

describe('the html part', () => {
  const blocks: Block[] = [{ paragraph: 'Hello' }, { note: 'Bye' }]

  it('carries the installation as the only thing standing for a logo', () => {
    expect(htmlFrom({ installation: 'The Burning Sage', blocks })).toContain('The Burning Sage')
  })

  it('holds every style inline, since a mail client strips a stylesheet', () => {
    const html = htmlFrom({ installation: 'X', blocks })

    expect(html).not.toContain('<style')
    expect(html).not.toContain('<link')
  })

  it('fetches nothing when it is opened', () => {
    // A remote image is a read receipt and a webfont is ignored anyway. Links are a
    // different thing — they are fetched when somebody chooses to follow one.
    const html = htmlFrom({ installation: 'X', blocks })

    expect(html).not.toContain('<img')
    expect(html).not.toContain('@import')
    expect(html).not.toContain('url(')
  })

  it('escapes what a member wrote, in the text and in the link alike', () => {
    const html = htmlFrom({
      installation: 'X',
      blocks: [{ lines: [{ text: '<script>alert(1)</script>', href: 'https://x/"onmouseover="alert(1)' }] }],
    })

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&quot;onmouseover=&quot;')
  })

  it('escapes the installation name too, which an admin types', () => {
    expect(htmlFrom({ installation: '<b>Sage</b>', blocks })).not.toContain('<b>Sage</b>')
  })
})

describe('escaping', () => {
  it('covers every character that could end an attribute or open a tag', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })

  it('escapes the ampersand first, so an entity is not written twice', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;')
  })
})
