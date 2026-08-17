import { describe, expect, it } from 'vitest'

import type { ShareEvent, ShareSubject } from './share.ts'

import { plainFromMarkdown, shareHead, truncate } from './share.ts'

const BURN: ShareEvent = {
  name: 'Autumn Burn',
  start_date: '2026-10-02',
  end_date: '2026-10-04',
  start_time: '15:00',
  end_time: '14:00',
  location: 'Sagegården, Rättvik',
  welcome_markdown: '# Welcome\n\nFiery weekend burn 🔥 out on a [farm](https://example.org).',
}

const subject = (overrides: Partial<ShareSubject> = {}): ShareSubject => ({
  installation: 'The Burning Sage',
  origin: 'https://burn.example.org',
  event: BURN,
  image: {
    path: '/api/installation/banner?v=2026-08-07T10%3A00%3A00.000Z',
    type: 'image/jpeg',
    width: 1200,
    height: 630,
  },
  ...overrides,
})

const content = (head: string, name: string): string | undefined =>
  new RegExp(`<meta (?:name|property)="${name}" content="([^"]*)" />`).exec(head)?.[1]

const jsonLd = (head: string): Record<string, unknown> => {
  const found = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(head)?.[1]
  if (found === undefined) throw new Error('no structured data')

  return JSON.parse(found) as Record<string, unknown>
}

describe('the share card', () => {
  it('names the burn and the installation, in that order', () => {
    const head = shareHead(subject())

    expect(head).toContain('<title>Autumn Burn · The Burning Sage</title>')
    expect(content(head, 'og:title')).toBe('Autumn Burn · The Burning Sage')
    expect(content(head, 'og:site_name')).toBe('The Burning Sage')
  })

  it('falls back to the installation when no burn is open', () => {
    const head = shareHead(subject({ event: undefined }))

    expect(head).toContain('<title>The Burning Sage</title>')
    expect(content(head, 'og:type')).toBe('website')
    expect(content(head, 'og:description')).toBeUndefined()
    expect(content(head, 'description')).toBeUndefined()
  })

  it('puts the dates and the place in front of the welcome text', () => {
    const description = content(shareHead(subject()), 'og:description')

    expect(description).toBe(
      '2026-10-02 – 2026-10-04 · Sagegården, Rättvik · Welcome Fiery weekend burn 🔥 out on a farm.',
    )
  })

  it('says one date when the burn is one day', () => {
    const oneDay = { ...BURN, end_date: BURN.start_date }

    expect(content(shareHead(subject({ event: oneDay })), 'og:description')).toContain(
      '2026-10-02 · Sagegården',
    )
  })

  it('says the dates and nothing else when nobody has written a welcome', () => {
    const bare = { ...BURN, welcome_markdown: '', location: '' }

    expect(content(shareHead(subject({ event: bare })), 'og:description')).toBe('2026-10-02 – 2026-10-04')
  })

  it('types the burn as an event, even where Facebook will read it as other', () => {
    expect(content(shareHead(subject()), 'og:type')).toBe('event')
  })

  it('escapes what an admin typed rather than letting it close the attribute', () => {
    const head = shareHead(subject({ installation: 'Bad" onload="x' }))

    expect(head).toContain('content="Bad&quot; onload=&quot;x"')
    expect(head).not.toContain('onload="x"')
  })

  it('escapes the title into text rather than markup', () => {
    const head = shareHead(subject({ installation: '<script>alert(1)</script>', event: undefined }))

    expect(head).toContain('<title>&lt;script&gt;alert(1)&lt;/script&gt;</title>')
  })
})

describe('the card image', () => {
  it('claims the large card for the banner, with its size', () => {
    const head = shareHead(subject())

    expect(content(head, 'og:image')).toBe(
      'https://burn.example.org/api/installation/banner?v=2026-08-07T10%3A00%3A00.000Z',
    )
    expect(content(head, 'og:image:width')).toBe('1200')
    expect(content(head, 'og:image:height')).toBe('630')
    expect(content(head, 'og:image:alt')).toBe('Autumn Burn')
    expect(content(head, 'twitter:card')).toBe('summary_large_image')
  })

  it('asks for the small card when the picture is the square icon', () => {
    const head = shareHead(
      subject({ image: { path: '/api/installation/icon?v=1', type: 'image/png', width: 512, height: 512 } }),
    )

    expect(content(head, 'twitter:card')).toBe('summary')
    expect(content(head, 'og:image:width')).toBe('512')
  })

  it('declares no size for an SVG, which has none of its own', () => {
    const head = shareHead(
      subject({ image: { path: '/api/installation/icon?v=default', type: 'image/svg+xml' } }),
    )

    expect(content(head, 'og:image')).toContain('/api/installation/icon?v=default')
    expect(content(head, 'og:image:width')).toBeUndefined()
    expect(content(head, 'twitter:card')).toBe('summary')
  })

  it('leaves out the absolute tags when the request did not say where it arrived', () => {
    const head = shareHead(subject({ origin: undefined }))

    expect(content(head, 'og:image')).toBeUndefined()
    expect(content(head, 'og:url')).toBeUndefined()
    expect(content(head, 'og:title')).toBe('Autumn Burn · The Burning Sage')
  })

  it('points og:url at the origin rather than at the page that was shared', () => {
    expect(content(shareHead(subject()), 'og:url')).toBe('https://burn.example.org')
  })
})

describe('the structured data', () => {
  it('carries the dates and times Google reads for a rich result', () => {
    const data = jsonLd(shareHead(subject()))

    expect(data['@type']).toBe('Event')
    expect(data['startDate']).toBe('2026-10-02T15:00')
    expect(data['endDate']).toBe('2026-10-04T14:00')
    expect(data['location']).toEqual({ '@type': 'Place', name: 'Sagegården, Rättvik' })
    expect(data['image']).toEqual([
      'https://burn.example.org/api/installation/banner?v=2026-08-07T10%3A00%3A00.000Z',
    ])
  })

  it('leaves the place out rather than claiming an empty one', () => {
    const data = jsonLd(shareHead(subject({ event: { ...BURN, location: '' } })))

    expect(data['location']).toBeUndefined()
    expect(data['name']).toBe('Autumn Burn')
  })

  it('is absent when there is no burn to describe', () => {
    expect(shareHead(subject({ event: undefined }))).not.toContain('ld+json')
  })

  it('cannot be closed early by what somebody typed', () => {
    const attack = { ...BURN, name: 'Autumn </script><script>alert(1)</script>' }
    const head = shareHead(subject({ event: attack }))

    expect(head).toContain('\\u003c/script>')
    expect(head).not.toContain('</script><script>alert(1)')
    expect(jsonLd(head)['name']).toBe(attack.name)
  })
})

describe('markdown as a card reads it', () => {
  it('keeps the words and drops the marks', () => {
    expect(plainFromMarkdown('## Lodging\n\n- **Tents**\n- _Temple_\n\n> a quote\n')).toBe(
      'Lodging Tents Temple a quote',
    )
  })

  it('keeps a link’s text and drops its target', () => {
    expect(plainFromMarkdown('The [principles](https://example.org/x) inspire us')).toBe(
      'The principles inspire us',
    )
  })

  it('keeps an image’s alt text and drops the image', () => {
    expect(plainFromMarkdown('![the fire](https://example.org/fire.png) burns')).toBe('the fire burns')
  })

  it('cuts at a word boundary and says it was cut', () => {
    const text = 'one two three four five six seven'

    expect(truncate(text, 20)).toBe('one two three four…')
  })

  it('leaves a short text exactly as it is', () => {
    expect(truncate('one two', 20)).toBe('one two')
  })

  it('cuts mid-word rather than to nothing when there is no space to cut at', () => {
    expect(truncate('a'.repeat(30), 10)).toBe(`${'a'.repeat(9)}…`)
  })
})
