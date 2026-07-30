import { describe, expect, it } from 'vitest'

import { renderMarkdown } from './markdown.ts'

describe('renderMarkdown', () => {
  it('renders ordinary markdown', () => {
    const html = renderMarkdown('# Welcome\n\nBring **water** and a [map](/map).')

    expect(html).toContain('<h1>Welcome</h1>')
    expect(html).toContain('<strong>water</strong>')
    expect(html).toContain('href="/map"')
  })

  it('neutralises a script tag', () => {
    // Admin-authored, but an admin account is one phished password away from
    // being someone else — and this text is shown to every public visitor.
    //
    // The assertion is that no `<script` reaches the document, not that the
    // characters "alert(1)" are absent: escaped, they are visible text on the
    // page and inert. Demanding their absence would be testing the filtering
    // approach this deliberately does not use.
    const html = renderMarkdown('Hello <script>alert(1)</script> there')

    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script&gt;')
  })

  it('neutralises an event handler attribute', () => {
    // Same shape: the whole tag becomes text, so there is no element for
    // `onerror` to be an attribute of.
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
    // The deliberate trade: literal tags show as text. Markdown still has
    // emphasis, headings, lists and links, which is all this field needs — and
    // escaping has no allowlist to get wrong.
    const html = renderMarkdown('A line<br>and <em>emphasis</em>')

    expect(html).toContain('&lt;br&gt;')
    expect(html).toContain('&lt;em&gt;')
  })

  it('renders markdown emphasis, which is what replaces inline HTML', () => {
    expect(renderMarkdown('some *emphasis*')).toContain('<em>emphasis</em>')
  })

  it('strips other executable schemes, not just javascript:', () => {
    // An allowlist, so this holds without knowing each scheme by name.
    for (const href of ['data:text/html;base64,PHNjcmlwdD4=', 'vbscript:msgbox(1)', 'JaVaScRiPt:alert(1)']) {
      const html = renderMarkdown(`[x](${href})`)
      expect(html, href).not.toContain('href=')
    }
  })

  it('keeps relative, anchor and mailto links', () => {
    // The common shapes in a welcome text; an allowlist that rejected these
    // would be useless in practice and get removed.
    expect(renderMarkdown('[a](/apply)')).toContain('href="/apply"')
    expect(renderMarkdown('[b](#lodging)')).toContain('href="#lodging"')
    expect(renderMarkdown('[c](mailto:crew@example.org)')).toContain('href="mailto:crew@example.org"')
  })

  it('keeps emphasis inside a link', () => {
    // The renderer override must go through `parseInline`, not the raw text.
    expect(renderMarkdown('[**bold** link](/x)')).toContain('<strong>bold</strong>')
  })

  it('rejects an image with an unsafe source', () => {
    const html = renderMarkdown('![alt](javascript:alert(1))')

    expect(html).not.toContain('src=')
  })

  it('is empty for empty input', () => {
    expect(renderMarkdown('').trim()).toBe('')
  })
})
