export type Block =
  | { paragraph: string }
  | { heading: string }
  | { action: { href: string; label: string } }
  | { lines: readonly { text: string; href?: string }[] }
  | { note: string; link?: { href: string; label: string } }

export const WRAP_AT = 76

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export const escapeHtml = (value: string): string =>
  value.replaceAll(/[&<>"']/gu, (one) => ESCAPES[one] ?? one)

export const wrapped = (text: string, width = WRAP_AT): string[] => {
  const lines: string[] = []
  let line = ''

  for (const word of text.split(' ').filter((one) => one !== '')) {
    if (line === '') {
      line = word
    } else if (`${line} ${word}`.length <= width) {
      line = `${line} ${word}`
    } else {
      lines.push(line)
      line = word
    }
  }
  if (line !== '') lines.push(line)

  return lines.length === 0 ? [''] : lines
}

const isNote = (block: Block): block is { note: string } => 'note' in block

/** Continuations line up under the first word rather than under the dash. */
const bulleted = (text: string, width = WRAP_AT): string[] => {
  const [first = '', ...rest] = wrapped(text, width - 2)

  return [`- ${first}`, ...rest.map((line) => `  ${line}`)]
}

export const textFrom = (blocks: readonly Block[]): string => {
  const firstNote = blocks.findIndex(isNote)
  const out: string[] = []

  blocks.forEach((block, at) => {
    if (at === firstNote) out.push('--')

    if ('paragraph' in block) out.push(...wrapped(block.paragraph), '')
    else if ('heading' in block) out.push(...wrapped(block.heading), '')
    else if ('action' in block) out.push(block.action.href, '')
    else if ('note' in block) {
      out.push(...wrapped(block.note))
      if (block.link !== undefined) out.push(block.link.href)
    } else {
      for (const line of block.lines) {
        out.push(...bulleted(line.text))
        if (line.href !== undefined) out.push(`  ${line.href}`)
      }
      out.push('')
    }
  })

  return out.join('\n').replace(/\n+$/u, '')
}

const INK = '#1c1917'
const PAPER = '#faf7f2'
const MUTED = '#78716c'
const LINE = '#e0d9cf'
const EMBER = '#c2410c'
const GROUND = '#f2ede4'

const SERIF = "Georgia, 'Times New Roman', serif"
const SANS = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

const htmlBlock = (block: Block): string => {
  if ('paragraph' in block) {
    return `<p style="margin:0 0 14px;">${escapeHtml(block.paragraph)}</p>`
  }
  if ('heading' in block) {
    return `<h2 style="font-family:${SANS};font-size:15px;font-weight:600;margin:22px 0 8px;color:${INK};">${escapeHtml(block.heading)}</h2>`
  }
  if ('action' in block) {
    return `<p style="margin:18px 0;"><a href="${escapeHtml(block.action.href)}" style="display:inline-block;padding:10px 18px;background:${EMBER};color:${PAPER};text-decoration:none;border-radius:6px;font-family:${SANS};font-size:15px;">${escapeHtml(block.action.label)}</a></p>`
  }
  if ('note' in block) {
    const said = escapeHtml(block.note)
    const shown =
      block.link === undefined
        ? said
        : `${said} <a href="${escapeHtml(block.link.href)}" style="color:${EMBER};">${escapeHtml(block.link.label)}</a>`

    return `<p style="margin:0;padding-top:14px;border-top:1px solid ${LINE};font-family:${SANS};font-size:13px;line-height:1.5;color:${MUTED};">${shown}</p>`
  }

  const items = block.lines
    .map((line) => {
      const said = escapeHtml(line.text)
      const shown =
        line.href === undefined
          ? said
          : `<a href="${escapeHtml(line.href)}" style="color:${EMBER};">${said}</a>`

      return `<li style="margin:0 0 6px;">${shown}</li>`
    })
    .join('')

  return `<ul style="margin:0 0 14px;padding-inline-start:20px;">${items}</ul>`
}

export const htmlFrom = ({
  installation,
  blocks,
}: {
  installation: string
  blocks: readonly Block[]
}): string =>
  [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="color-scheme" content="light">',
    `<title>${escapeHtml(installation)}</title>`,
    '</head>',
    `<body style="margin:0;padding:0;background:${GROUND};">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${GROUND};">`,
    '<tr><td align="center" style="padding:24px 12px;">',
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:${PAPER};border:1px solid ${LINE};border-radius:8px;">`,
    `<tr><td style="padding:24px 28px;font-family:${SERIF};font-size:16px;line-height:1.6;color:${INK};">`,
    `<div style="font-family:${SANS};font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};padding-bottom:16px;">${escapeHtml(installation)}</div>`,
    ...blocks.map(htmlBlock),
    '</td></tr></table>',
    '</td></tr></table>',
    '</body></html>',
  ].join('')
