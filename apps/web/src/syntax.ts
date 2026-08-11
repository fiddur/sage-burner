export interface Span {
  start: number
  end: number
}

export interface Written extends Span {
  value: string
}

export type SyntaxKind = 'bold' | 'italic' | 'link' | 'list'

const fits = (value: string, added: number, maxLength: number | undefined): boolean =>
  maxLength === undefined || value.length + added <= maxLength

const BOLD = '**'

/**
 * Underscores rather than a single asterisk. `*` around a selection inside `**bold**` reads as
 * the unwrap below and turns bold into italic, and the two markers render the same.
 */
const ITALIC = '_'

const withWrappedSelection = (
  value: string,
  { start, end }: Span,
  marker: string,
  maxLength?: number,
): Written => {
  const before = start - marker.length
  const wrapped =
    before >= 0 && value.slice(before, start) === marker && value.slice(end, end + marker.length) === marker

  if (wrapped) {
    return {
      value: `${value.slice(0, before)}${value.slice(start, end)}${value.slice(end + marker.length)}`,
      start: before,
      end: end - marker.length,
    }
  }

  if (!fits(value, marker.length * 2, maxLength)) return { value, start, end }

  return {
    value: `${value.slice(0, start)}${marker}${value.slice(start, end)}${marker}${value.slice(end)}`,
    start: start + marker.length,
    end: end + marker.length,
  }
}

export const LINK_PLACEHOLDER = 'https://'

const withLinkAt = (value: string, { start, end }: Span, maxLength?: number): Written => {
  const text = value.slice(start, end)
  const written = `[${text}](${LINK_PLACEHOLDER})`

  if (!fits(value, written.length - text.length, maxLength)) return { value, start, end }

  const at = start + text.length + 3

  return {
    value: `${value.slice(0, start)}${written}${value.slice(end)}`,
    start: at,
    end: at + LINK_PLACEHOLDER.length,
  }
}

const BULLET = '- '

const linesAround = (value: string, { start, end }: Span): { from: number; to: number } => {
  const to = value.indexOf('\n', end)

  return { from: value.lastIndexOf('\n', start - 1) + 1, to: to === -1 ? value.length : to }
}

const withListAt = (value: string, selection: Span, maxLength?: number): Written => {
  const { from, to } = linesAround(value, selection)
  const lines = value.slice(from, to).split('\n')
  const listed = lines.every((line) => line.startsWith(BULLET))
  const written = lines.map((line) => (listed ? line.slice(BULLET.length) : `${BULLET}${line}`)).join('\n')

  if (!listed && !fits(value, written.length - (to - from), maxLength)) {
    return { value, ...selection }
  }

  return {
    value: `${value.slice(0, from)}${written}${value.slice(to)}`,
    start: from,
    end: from + written.length,
  }
}

export const written = (kind: SyntaxKind, value: string, selection: Span, maxLength?: number): Written => {
  if (kind === 'bold') return withWrappedSelection(value, selection, BOLD, maxLength)
  if (kind === 'italic') return withWrappedSelection(value, selection, ITALIC, maxLength)
  if (kind === 'link') return withLinkAt(value, selection, maxLength)

  return withListAt(value, selection, maxLength)
}

const SYNTAX: readonly RegExp[] = [
  /\*\*[^*\n]+\*\*/u,
  /(?:^|\s)_[^_\n]+_(?:\s|$)/u,
  /!?\[[^\]\n]*\]\([^)\n]*\)/u,
  /^#{1,6}\s/mu,
  /^\s*[-*+]\s/mu,
  /^\s*\d+\.\s/mu,
  /^\s*>\s/mu,
  /`[^`\n]+`/u,
]

export const hasMarkdown = (value: string): boolean => SYNTAX.some((one) => one.test(value))
