import { describe, expect, it } from 'vitest'

import { flameIcon } from './media.ts'

describe('the app’s own mark', () => {
  it('draws the flame, and only the flame', () => {
    expect(flameIcon()).toBe(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
        `<text y="52" font-size="52">🔥</text>` +
        `</svg>`,
    )
  })

  it('carries no badge of its own — the dot is the tab’s, drawn on a canvas', () => {
    // `flameIcon({ badged: true })` drew a `<circle>` until #285 put the dot on a
    // canvas over the installation's own icon. Nothing called it afterwards, and four
    // places went on describing it, so the option went rather than the descriptions.
    expect(flameIcon()).not.toContain('<circle')
  })
})
