import { mentionsAsLinks } from '@sage-burner/shared'
import { Marked } from 'marked'

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const clean = (href: string) => href.trim().replaceAll(/[\u0000-\u001f]/gu, '')

const isSafeUrl = (href: string) => /^(?:https?:\/\/|mailto:|#|\/(?![/\\]))/i.test(clean(href))

const isSafeImageSource = (href: string) => /^(?:https:\/\/|\/(?![/\\]))/i.test(clean(href))

const titleAttribute = (title: string | null | undefined) =>
  title === null || title === undefined ? '' : ` title="${escapeHtml(title)}"`

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
      return `<img src="${escapeHtml(clean(token.href))}" alt="${escapeHtml(token.text)}" loading="lazy"${title}>`
    },
  },
})

export const renderMarkdown = (source: string): string =>
  marked.parse(mentionsAsLinks(source), { async: false })
