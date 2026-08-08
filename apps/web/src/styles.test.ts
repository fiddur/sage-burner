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

/** Innermost rules only — an at-rule's body contains braces, so it never matches. */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
  selector: (selector ?? '').trim().replaceAll(/\s+/g, ' '),
  body: body ?? '',
}))

describe('the stylesheet', () => {
  it('has rules to read at all', () => {
    // The parse is a regex, so a change to the file that broke it would otherwise turn
    // every check below into a vacuous pass over an empty list.
    expect(rules.length).toBeGreaterThan(100)
    expect(rules.some((rule) => rule.selector === '.visually-hidden')).toBe(true)
  })

  it('positions every box that scrolls sideways', () => {
    /*
      `.visually-hidden` is `position: absolute`, so without a positioned ancestor its
      containing block is the *initial* one. Inside a table scrolled sideways it then
      sits at its static position — past the right edge of the screen — and drags the
      whole document's scroll width out with it, which is what made the Leads page
      scroll sideways beside its own table and took the fixed bottom bar with it (#348).

      Anything establishing a horizontal scroll container therefore has to be a
      containing block, so what is inside it stays inside it. Vertical-only scrollers
      are exempt: they cannot push the document sideways.
    */
    const sideways = rules.filter((rule) => /overflow(-x)?:\s*(auto|scroll)/.test(rule.body))

    expect(sideways.length).toBeGreaterThan(0)
    for (const rule of sideways) {
      expect(rule.body, `${rule.selector} scrolls sideways and must be a containing block`).toMatch(
        /position:\s*(relative|absolute|fixed|sticky)/,
      )
    }
  })
})
