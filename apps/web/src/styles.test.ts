import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The stylesheet, read as text.
 *
 * happy-dom applies no CSS, so nothing else in this suite can see a layout bug. What
 * *is* checkable is an invariant the file itself has to keep, and this one cost a live
 * regression: it is invisible in every rendering test and in every browser wide enough
 * that nothing scrolls sideways.
 */
// From the working directory rather than from `import.meta.url`, as `shell.test.ts`
// does and for the same reason: the suite runs in happy-dom, where that is an http URL.
const css = readFileSync(path.resolve(process.cwd(), 'src/styles.css'), 'utf8').replaceAll(
  /\/\*[\s\S]*?\*\//g,
  '',
)

/**
 * Innermost rules only — an at-rule's body contains braces, so it never matches.
 *
 * This would fold declarations into the *selector* capture for a rule containing a
 * nested one, which would drop that rule from every check below. The stylesheet uses
 * no CSS nesting, and adopting it means rewriting this.
 */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
  selector: (selector ?? '').trim().replaceAll(/\s+/g, ' '),
  body: body ?? '',
}))

/**
 * Every `@media (max-width: 45rem)` block, joined — the file has several.
 *
 * The parse above flattens at-rules away, so a rule inside one is indistinguishable
 * from a global rule of the same selector — and "the bar does not wrap" is true only
 * on a phone, where the pages have already moved to the bottom bar.
 */
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
    // The parse is a regex, so a change to the file that broke it would otherwise turn
    // every check below into a vacuous pass over an empty list.
    expect(rules.length).toBeGreaterThan(100)
    const selectors = rules.flatMap((rule) => rule.selector.split(',').map((one) => one.trim()))
    expect(selectors).toContain('.visually-hidden')
  })

  it("pins the top bar's nav rather than spreading the bar", () => {
    // The bar's children come and go — ☰ only for a member, the selector only for a
    // second burn — so `space-between` puts whatever is in the middle *in the middle*:
    // ☰ landed halfway across the bar the day it became a third child, on the ordinary
    // one-burn viewer. happy-dom lays nothing out, so this is the only place it shows.
    const header = rules.find((rule) => rule.selector === '.site-header')
    const nav = rules.find((rule) => rule.selector === '.top-nav')

    expect(header?.body).not.toMatch(/justify-content:\s*space-between/)
    expect(nav?.body).toMatch(/margin-inline-start:\s*auto/)
  })

  it("keeps a phone's bar to one row, and gives way with the name rather than the corner", () => {
    // What the bar dropped to a second row on a phone was 🔔, ⚙️ and the face — an
    // admin's corner is a third icon wide, so theirs went over first — leaving the
    // whole right half of the first row empty. So: no wrapping where the pages have
    // already moved to the bottom bar, and the installation's name is what shortens.
    expect(phone).toMatch(/\.site-header\s*\{[^}]*flex-wrap:\s*nowrap/)
    expect(rules.find((rule) => rule.selector === '.brand-name')?.body).toMatch(/text-overflow:\s*ellipsis/)
    expect(rules.find((rule) => rule.selector === '.brand-name')?.body).toMatch(/min-width:\s*0/)
    expect(rules.find((rule) => rule.selector === '.brand')?.body).toMatch(/min-width:\s*0/)
  })

  it('holds the bell, ⚙️ and the face together at every width', () => {
    // They are the session rather than a page, and where a hand goes without looking.
    // Above 45rem the bar still wraps — the six page words need the room — and this is
    // what stops that wrap falling between the words and the corner.
    const session = rules.find((rule) => rule.selector === '.nav-session')

    expect(session?.body).toMatch(/flex-wrap:\s*nowrap/)
    expect(session?.body).toMatch(/flex:\s*none/)
  })

  it('names the flexible child of a reorderable row rather than counting it', () => {
    // `ReorderableList` renders its own controls as the row's first child, so a positional
    // selector counts from something the component owns — and adding a child moves it. It
    // picked the `aria-hidden` icon rather than the text the day one was written that way,
    // leaving a 200-character handle to push the actions off the side of a phone. Every
    // other list here names the element instead: `.reorder-name`, `.faq-entry`.
    const rows = /\.(reorder|connection|faq|question)-row/
    const counted = rules.filter(
      (rule) => rows.test(rule.selector) && /:nth-(of-type|child)/.test(rule.selector),
    )

    expect(counted.map((rule) => rule.selector)).toEqual([])
  })

  it('gives the song editor a monospace face that outranks the shared field rule', () => {
    // `.field textarea` sets `font: inherit` at (0,1,1), so a bare `.song-editor` loses to it
    // and the editor came out proportional — which slides every chord off the syllable it was
    // typed above. Both halves are the claim: the face, and the selector that can win.
    const editor = rules.find((rule) => rule.selector === '.field textarea.song-editor')

    expect(editor?.body).toMatch(/font-family:[^;]*monospace/)
    expect(rules.find((rule) => rule.selector === '.song-body')?.body).toMatch(/font-family:[^;]*monospace/)
  })

  it('keeps the nudge above the popdown that raises it, and under the drawer', () => {
    const layer = (selector: string) =>
      Number(/z-index:\s*(\d+)/.exec(rules.find((rule) => rule.selector === selector)?.body ?? '')?.[1])

    expect(layer('.push-nudge')).toBeGreaterThan(layer('.card-bell-menu'))
    expect(layer('.push-nudge')).toBeGreaterThan(layer('.bell-panel'))
    expect(layer('.push-nudge')).toBeLessThan(layer('.menu-backdrop'))
    expect(layer('.push-nudge')).toBeGreaterThan(layer('.bottom-bar'))
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
    // Anything establishing a horizontal scroll container has to be a containing
    // block, so an absolutely positioned descendant cannot escape to the document and
    // drag its scroll width out (#348) — `docs/the-app.md` has the why. Vertical-only
    // scrollers are exempt: they cannot push the document sideways.
    const sideways = rules.filter((rule) => /overflow(-x)?:\s*(auto|scroll)/.test(rule.body))

    expect(sideways.length).toBeGreaterThan(0)
    for (const rule of sideways) {
      expect(rule.body, `${rule.selector} scrolls sideways and must be a containing block`).toMatch(
        /position:\s*(relative|absolute|fixed|sticky)/,
      )
    }
  })
})
