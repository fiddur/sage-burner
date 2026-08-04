import { Marked } from 'marked'

/**
 * Markdown rendered to HTML that is safe to insert, whoever wrote it.
 *
 * Members author it as well as admins — any longer field shown to other people is
 * markdown — so the input here is untrusted.
 *
 * **Raw HTML is escaped rather than filtered.** The obvious build here is
 * `marked` + DOMPurify, and it was the first one — but DOMPurify needs a real
 * DOM, and under happy-dom it reports `isSupported: true` while doing nothing:
 * `sanitize('<h1>a</h1><script>b</script>')` returns `a<script>b</script>`,
 * dropping the safe tag and keeping the dangerous one. A sanitiser that cannot
 * be exercised by the suite is a security control on trust, and this one was
 * actively wrong in the environment the tests run in.
 *
 * Escaping needs no DOM, so it behaves identically in Node, in the test
 * environment and in the browser, and the tests below actually prove it. It is
 * also a stricter rule than filtering: there is no allowlist to get wrong, and
 * no gap between how a sanitiser parses the input and how the browser does.
 *
 * The cost is that literal `<br>` or `<em>` renders as visible text rather than
 * markup. That is a fair trade for a field edited in a textarea — markdown already
 * has emphasis, lists, headings and links, which is the whole vocabulary these
 * fields need.
 *
 * Link and image URLs are checked separately, because escaping does nothing
 * about `[click](javascript:…)` — that is markdown, not HTML.
 */

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

/**
 * Schemes a link may use.
 *
 * An allowlist rather than a `javascript:` denylist: `data:text/html`,
 * `vbscript:` and a tab-separated `java\tscript:` all execute too, and a
 * denylist has to know about each. Site-relative and anchor links are the
 * common case in a welcome text and pass through.
 *
 * The `/` branch excludes `//` and `/\`: both are protocol-relative rather than
 * site-relative, and browsers normalise `/\evil.com` to `//evil.com`, so a link
 * that reads as site-relative in the markdown source would navigate off-site.
 * No privilege is gained — whoever writes this field can put `https://evil.com`
 * in it outright — but "site-relative" should mean what it says.
 *
 * Control characters are stripped before the test, not merely trimmed.
 * `marked`'s angle-bracket destination form accepts tabs, and because these
 * renderer overrides bypass its `cleanUrl()` nothing percent-encodes them — so
 * `</\t/evil.com>` would reach the attribute as `/<tab>/evil.com`, and the
 * browser discards tab, CR and LF while parsing a URL, leaving `//evil.com`.
 *
 * The renderers emit `escapeHtml(clean(href))`, not `escapeHtml(href)`, so the
 * string reaching the attribute is the one that was tested. They used to
 * differ — the check ran on the cleaned value while the raw one was written
 * out. No href was found that is safe cleaned and unsafe raw, so this closes a
 * seam rather than a hole; the point is that the property now holds without
 * anyone having to re-derive it.
 */
const clean = (href: string) => href.trim().replaceAll(/[\u0000-\u001f]/gu, '')

const isSafeUrl = (href: string) => /^(?:https?:\/\/|mailto:|#|\/(?![/\\]))/i.test(clean(href))

/**
 * Stricter than `isSafeUrl`, because an image is fetched rather than navigated to
 * and the CSP governs that fetch.
 *
 * `img-src` is `'self' data: https:`, so a plain `http://` image would be
 * rendered into the page and then refused by the policy — the exact mismatch the
 * CSP was widened to remove, just on the other scheme. Links are unaffected:
 * navigation is not covered by `img-src`, so `http://` stays fine there.
 */
const isSafeImageSource = (href: string) => /^(?:https:\/\/|\/(?![/\\]))/i.test(clean(href))

/** `null` and `undefined` both mean "no title"; marked uses both. */
const titleAttribute = (title: string | null | undefined) =>
  title === null || title === undefined ? '' : ` title="${escapeHtml(title)}"`

/**
 * Content headings are shifted down one level.
 *
 * The page owns `<h1>` (the site name) and `<h2>` (the event name), so a `#` in
 * the welcome text becoming another `<h1>` *below* that `<h2>` breaks the
 * document outline that screen readers navigate by. `#` renders as `<h2>` here,
 * clamped at `<h6>` since there is no `<h7>`.
 */
const HEADING_SHIFT = 1

const marked = new Marked({
  renderer: {
    html: ({ text }) => escapeHtml(text),

    heading(token) {
      const level = Math.min(token.depth + HEADING_SHIFT, 6)
      return `<h${level}>${this.parser.parseInline(token.tokens)}</h${level}>\n`
    },

    link(token) {
      const text = this.parser.parseInline(token.tokens)
      if (!isSafeUrl(token.href)) return text

      const title = titleAttribute(token.title)
      return `<a href="${escapeHtml(clean(token.href))}"${title}>${text}</a>`
    },

    image(token) {
      if (!isSafeImageSource(token.href)) return escapeHtml(token.text)

      const title = titleAttribute(token.title)
      return `<img src="${escapeHtml(clean(token.href))}" alt="${escapeHtml(token.text)}"${title}>`
    },
  },
})

export const renderMarkdown = (source: string): string => marked.parse(source, { async: false })
