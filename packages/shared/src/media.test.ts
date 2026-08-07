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
})
