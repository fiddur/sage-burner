import { describe, expect, it } from 'vitest'

import { renderMarkdown } from './markdown.ts'

describe('renderMarkdown', () => {
  it('renders ordinary markdown', () => {
    const html = renderMarkdown('# Welcome\n\nBring **water** and a [map](/map).')

    // `<h2>`, not `<h1>`: the page owns its own `h1` (the site name) and `h2`
    // (the event name), so content headings are shifted down one to keep the
    // document outline navigable.
    expect(html).toContain('<h2>Welcome</h2>')
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

  it('clamps the heading shift at h6, since there is no h7', () => {
    expect(renderMarkdown('###### deep')).toContain('<h6>deep</h6>')
  })

  it('keeps inline markup inside a heading', () => {
    // The override must go through `parseInline`, not the raw text.
    expect(renderMarkdown('# a *word*')).toContain('<em>word</em>')
  })

  it('rejects an http image, which the CSP would refuse anyway', () => {
    // `img-src` is `'self' data: https:`. Rendering an http image would be the
    // same allowlist-vs-policy mismatch the CSP was widened to remove.
    expect(renderMarkdown('![x](http://host/a.jpg)')).not.toContain('src=')
  })

  it('still allows an http *link*, which img-src does not govern', () => {
    expect(renderMarkdown('[x](http://host/page)')).toContain('href="http://host/page"')
  })

  it('rejects a site-relative link smuggling a tab', () => {
    // `marked`'s angle-bracket destination form accepts tabs, and these renderer
    // overrides bypass its `cleanUrl()`, so nothing percent-encodes them — the
    // browser then discards the tab while parsing, leaving `//evil.com`.
    const html = renderMarkdown('[x](</\t/evil.com>)')

    expect(html).not.toContain('href=')
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

  it('rejects a protocol-relative link that reads as site-relative', () => {
    // `//evil.com` and `/\evil.com` both navigate off-site — browsers normalise
    // the second to the first — while looking site-relative in the source.
    for (const href of ['//evil.com', String.raw`/\evil.com`]) {
      expect(renderMarkdown(`[x](${href})`), href).not.toContain('href=')
    }
  })

  it('still allows a genuine site-relative link', () => {
    expect(renderMarkdown('[x](/apply)')).toContain('href="/apply"')
  })

  it('allows an https image, which the CSP also permits', () => {
    // The allowlist and `img-src` have to agree: rendering an image the browser
    // then blocks looks like a bug rather than a policy.
    expect(renderMarkdown('![a photo](https://example.org/burn.jpg)')).toContain(
      'src="https://example.org/burn.jpg"',
    )
  })

  it('rejects an image with an unsafe source', () => {
    const html = renderMarkdown('![alt](javascript:alert(1))')

    expect(html).not.toContain('src=')
  })

  it('is empty for empty input', () => {
    expect(renderMarkdown('').trim()).toBe('')
  })
})
