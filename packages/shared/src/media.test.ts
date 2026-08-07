import { describe, expect, it } from 'vitest'

import { flameIcon, notificationBadge } from './media.ts'

describe('the app’s own mark', () => {
  it('draws the flame in a square the badge’s numbers are relative to', () => {
    expect(flameIcon()).toBe(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
        `<text y="52" font-size="52">🔥</text>` +
        `</svg>`,
    )
  })

  it('puts the dot on it, and nowhere else, when something is waiting', () => {
    // Written out rather than built from `notificationBadge`, which would pass
    // whatever that object said. This is the one place the numbers are asserted, so
    // the canvas that draws the same dot over an uploaded icon (#285) has something
    // to be wrong against.
    expect(flameIcon({ badged: true })).toBe(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
        `<text y="52" font-size="52">🔥</text>` +
        `<circle cx="50" cy="16" r="13" fill="#dc2626" stroke="#fff" stroke-width="3"/>` +
        `</svg>`,
    )
  })

  it('is the same mark either way — a dot added, nothing else changed', () => {
    // What the badge is *for*: the tab keeps its identity and gains a mark. Two
    // separate drawings would satisfy both tests above and fail this one.
    const plain = flameIcon()
    const badged = flameIcon({ badged: true })

    expect(badged.replace(/<circle[^>]*\/>/, '')).toBe(plain)
    expect(badged.length).toBeGreaterThan(plain.length)
  })

  it('measures the dot against the same square the flame is drawn in', () => {
    // The canvas path scales every number by `size / box`, so a `box` that did not
    // match the viewBox would put the dot somewhere else there than here.
    expect(notificationBadge.box).toBe(64)
    expect(flameIcon()).toContain(`viewBox="0 0 ${notificationBadge.box} ${notificationBadge.box}"`)
  })
})
