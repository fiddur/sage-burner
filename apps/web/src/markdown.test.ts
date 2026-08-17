import { describe, expect, it } from 'vitest'

import { renderMarkdown } from './markdown.ts'

describe('renderMarkdown', () => {
  it('renders ordinary markdown', () => {
    const html = renderMarkdown('# Welcome\n\nBring **water** and a [map](/map).')

    expect(html).toContain('<h2>Welcome</h2>')
    expect(html).toContain('<strong>water</strong>')
    expect(html).toContain('href="/map"')
  })

  it('neutralises a script tag', () => {
    const html = renderMarkdown('Hello <script>alert(1)</script> there')

    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script&gt;')
  })

  it('neutralises an event handler attribute', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">')

    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  it('strips a javascript: link but keeps the text', () => {
    const html = renderMarkdown('[click me](javascript:alert(1))')

    expect(html).not.toContain('javascript:')
    expect(html).toContain('click me')
  })

  it('escapes raw HTML rather than filtering it', () => {
    const html = renderMarkdown('A line<br>and <em>emphasis</em>')

    expect(html).toContain('&lt;br&gt;')
    expect(html).toContain('&lt;em&gt;')
  })

  it('renders markdown emphasis, which is what replaces inline HTML', () => {
    expect(renderMarkdown('some *emphasis*')).toContain('<em>emphasis</em>')
  })

  it('clamps the heading shift at h6, since there is no h7', () => {
    expect(renderMarkdown('###### deep')).toContain('<h6>deep</h6>')
  })

  it('keeps inline markup inside a heading', () => {
    expect(renderMarkdown('# a *word*')).toContain('<em>word</em>')
  })

  it('rejects an http image, which the CSP would refuse anyway', () => {
    expect(renderMarkdown('![x](http://host/a.jpg)')).not.toContain('src=')
  })

  it('still allows an http *link*, which img-src does not govern', () => {
    expect(renderMarkdown('[x](http://host/page)')).toContain('href="http://host/page"')
  })

  it('rejects a site-relative link smuggling a tab', () => {
    const html = renderMarkdown('[x](</\t/evil.com>)')

    expect(html).not.toContain('href=')
  })

  it('emits the href it checked, not the raw one', () => {
    expect(renderMarkdown('[x](</pa\tge>)')).toContain('href="/page"')
    expect(renderMarkdown('![x](<https://a.example/i\tmg.png>)')).toContain('src="https://a.example/img.png"')
  })

  it('strips other executable schemes, not just javascript:', () => {
    for (const href of ['data:text/html;base64,PHNjcmlwdD4=', 'vbscript:msgbox(1)', 'JaVaScRiPt:alert(1)']) {
      const html = renderMarkdown(`[x](${href})`)
      expect(html, href).not.toContain('href=')
    }
  })

  it('keeps relative, anchor and mailto links', () => {
    expect(renderMarkdown('[a](/apply)')).toContain('href="/apply"')
    expect(renderMarkdown('[b](#lodging)')).toContain('href="#lodging"')
    expect(renderMarkdown('[c](mailto:crew@example.org)')).toContain('href="mailto:crew@example.org"')
  })

  it('keeps emphasis inside a link', () => {
    expect(renderMarkdown('[**bold** link](/x)')).toContain('<strong>bold</strong>')
  })

  it('rejects a protocol-relative link that reads as site-relative', () => {
    for (const href of ['//evil.com', String.raw`/\evil.com`]) {
      expect(renderMarkdown(`[x](${href})`), href).not.toContain('href=')
    }
  })

  it('still allows a genuine site-relative link', () => {
    expect(renderMarkdown('[x](/apply)')).toContain('href="/apply"')
  })

  it('allows an https image, which the CSP also permits', () => {
    expect(renderMarkdown('![a photo](https://example.org/burn.jpg)')).toContain(
      'src="https://example.org/burn.jpg"',
    )
  })

  it('leaves every image lazy, wherever markdown is drawn', () => {
    expect(renderMarkdown('![a photo](https://example.org/burn.jpg)')).toContain('loading="lazy"')
    expect(renderMarkdown('![](/api/images/img-1)')).toContain('loading="lazy"')
  })

  it('rejects an image with an unsafe source', () => {
    const html = renderMarkdown('![alt](javascript:alert(1))')

    expect(html).not.toContain('src=')
  })

  it('is empty for empty input', () => {
    expect(renderMarkdown('').trim()).toBe('')
  })
})
