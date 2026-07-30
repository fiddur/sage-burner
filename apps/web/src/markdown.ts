import { Marked } from 'marked'

/**
 * Admin-authored markdown, rendered to HTML that is safe to insert.
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
 * The cost is that literal `<br>` or `<em>` in the welcome text renders as
 * visible text rather than markup. That is a fair trade for a field edited in a
 * textarea by an organiser — markdown already has emphasis, lists, headings and
 * links, which is the whole vocabulary this text needs.
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
 */
const isSafeUrl = (href: string) => /^(?:https?:\/\/|mailto:|\/|#)/i.test(href.trim())

/** `null` and `undefined` both mean "no title"; marked uses both. */
const titleAttribute = (title: string | null | undefined) =>
  title === null || title === undefined ? '' : ` title="${escapeHtml(title)}"`

const marked = new Marked({
  renderer: {
    html: ({ text }) => escapeHtml(text),

    link(token) {
      const text = this.parser.parseInline(token.tokens)
      if (!isSafeUrl(token.href)) return text

      const title = titleAttribute(token.title)
      return `<a href="${escapeHtml(token.href)}"${title}>${text}</a>`
    },

    image(token) {
      if (!isSafeUrl(token.href)) return escapeHtml(token.text)

      const title = titleAttribute(token.title)
      return `<img src="${escapeHtml(token.href)}" alt="${escapeHtml(token.text)}"${title}>`
    },
  },
})

export const renderMarkdown = (source: string): string => marked.parse(source, { async: false })
