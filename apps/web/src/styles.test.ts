import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(path.resolve(process.cwd(), 'src/styles.css'), 'utf8').replaceAll(
  /\/\*[\s\S]*?\*\//g,
  '',
)

const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
  selector: (selector ?? '').trim().replaceAll(/\s+/g, ' '),
  body: body ?? '',
}))

const phone = (() => {
  const query = '@media (max-width: 45rem)'
  const blocks: string[] = []

  for (let at = css.indexOf(query); at !== -1; at = css.indexOf(query, at + 1)) {
    let depth = 0

    for (let index = css.indexOf('{', at); index < css.length; index += 1) {
      if (css[index] === '{') depth += 1
      else if (css[index] === '}') {
        depth -= 1
        if (depth === 0) {
          blocks.push(css.slice(at, index))
          break
        }
      }
    }
  }

  return blocks.join('\n')
})()

describe('the stylesheet', () => {
  it('has rules to read at all', () => {
    expect(rules.length).toBeGreaterThan(100)
    const selectors = rules.flatMap((rule) => rule.selector.split(',').map((one) => one.trim()))
    expect(selectors).toContain('.visually-hidden')
  })

  it("pins the top bar's nav rather than spreading the bar", () => {
    const header = rules.find((rule) => rule.selector === '.site-header')
    const nav = rules.find((rule) => rule.selector === '.top-nav')

    expect(header?.body).not.toMatch(/justify-content:\s*space-between/)
    expect(nav?.body).toMatch(/margin-inline-start:\s*auto/)
  })

  it("keeps a phone's bar to one row, and gives way with the name rather than the corner", () => {
    expect(phone).toMatch(/\.site-header\s*\{[^}]*flex-wrap:\s*nowrap/)
    expect(rules.find((rule) => rule.selector === '.brand-name')?.body).toMatch(/text-overflow:\s*ellipsis/)
    expect(rules.find((rule) => rule.selector === '.brand-name')?.body).toMatch(/min-width:\s*0/)
    expect(rules.find((rule) => rule.selector === '.brand')?.body).toMatch(/min-width:\s*0/)
  })

  it('holds the bell, ⚙️ and the face together at every width', () => {
    const session = rules.find((rule) => rule.selector === '.nav-session')

    expect(session?.body).toMatch(/flex-wrap:\s*nowrap/)
    expect(session?.body).toMatch(/flex:\s*none/)
  })

  it('names the flexible child of a reorderable row rather than counting it', () => {
    const rows = /\.(reorder|connection|faq|question)-row/
    const counted = rules.filter(
      (rule) => rows.test(rule.selector) && /:nth-(of-type|child)/.test(rule.selector),
    )

    expect(counted.map((rule) => rule.selector)).toEqual([])
  })

  it('gives the song editor a monospace face that outranks the shared field rule', () => {
    const editor = rules.find((rule) => rule.selector === '.field textarea.song-editor')

    expect(editor?.body).toMatch(/font-family:[^;]*monospace/)
    expect(rules.find((rule) => rule.selector === '.song-body')?.body).toMatch(/font-family:[^;]*monospace/)
  })

  it('stacks the six rungs in the order docs/the-app.md writes down, ties and all', () => {
    const layer = (selector: string) =>
      Number(/z-index:\s*(\d+)/.exec(rules.find((rule) => rule.selector === selector)?.body ?? '')?.[1])

    const scale = [
      '.bottom-bar',
      '.card-bell-menu',
      '.push-nudge',
      '.menu-backdrop',
      '.menu-drawer',
      '.dream-modal',
    ]

    expect(scale.map(layer)).toEqual(scale.map(layer).sort((one, other) => one - other))
    expect(new Set(scale.map(layer)).size).toBe(scale.length)
    expect(layer('.bell-panel')).toBe(layer('.card-bell-menu'))
  })

  it('spaces a diary row rather than leaving its controls against the time', () => {
    const row = rules.find((rule) => rule.selector === '.meeting-list li')

    expect(row?.body).toMatch(/display:\s*flex/)
    expect(row?.body).toMatch(/gap:\s*[^;]+/)
  })

  it('lets the stuck sidebar scroll, its entries being taller than a short viewport', () => {
    const sidebar = rules.find((rule) => rule.selector === '.sidebar')

    expect(sidebar?.body).toMatch(/overflow-y:\s*auto/)
    expect(sidebar?.body).toMatch(/max-height:/)
  })

  it('positions every box that scrolls sideways', () => {
    const sideways = rules.filter((rule) => /overflow(-x)?:\s*(auto|scroll)/.test(rule.body))

    expect(sideways.length).toBeGreaterThan(0)
    for (const rule of sideways) {
      expect(rule.body, `${rule.selector} scrolls sideways and must be a containing block`).toMatch(
        /position:\s*(relative|absolute|fixed|sticky)/,
      )
    }
  })
})
