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

describe('the stylesheet', () => {
  it('has rules to read at all', () => {
    // The parse is a regex, so a change to the file that broke it would otherwise turn
    // every check below into a vacuous pass over an empty list.
    expect(rules.length).toBeGreaterThan(100)
    const selectors = rules.flatMap((rule) => rule.selector.split(',').map((one) => one.trim()))
    expect(selectors).toContain('.visually-hidden')
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
