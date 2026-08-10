import { describe, expect, it } from 'vitest'

import { createThrottle } from './throttle.ts'

const aClock = (start = 1_000_000) => {
  let at = start

  return { now: () => at, pass: (ms: number) => (at += ms) }
}

describe('bounding how often one key may try', () => {
  it('lets the allowance through and refuses the one after it', () => {
    const clock = aClock()
    const throttle = createThrottle({ attempts: 3, windowMs: 1000, now: clock.now })

    expect([throttle.take('a'), throttle.take('a'), throttle.take('a')].map((one) => one.ok)).toEqual([
      true,
      true,
      true,
    ])
    expect(throttle.take('a').ok).toBe(false)
  })

  it('says how long to wait, in whole seconds and never zero', () => {
    const clock = aClock()
    const throttle = createThrottle({ attempts: 1, windowMs: 5000, now: clock.now })
    throttle.take('a')

    const refused = throttle.take('a')
    expect(refused.ok === false && refused.retryAfterSeconds).toBe(5)

    clock.pass(4900)
    const nearly = throttle.take('a')
    expect(nearly.ok === false && nearly.retryAfterSeconds).toBe(1)
  })

  it('opens again once the window has passed', () => {
    const clock = aClock()
    const throttle = createThrottle({ attempts: 1, windowMs: 1000, now: clock.now })
    throttle.take('a')
    expect(throttle.take('a').ok).toBe(false)

    clock.pass(1000)

    expect(throttle.take('a').ok).toBe(true)
  })

  it('counts each key on its own, so one client cannot spend another’s allowance', () => {
    const clock = aClock()
    const throttle = createThrottle({ attempts: 1, windowMs: 1000, now: clock.now })

    throttle.take('a')

    expect(throttle.take('b').ok).toBe(true)
    expect(throttle.take('a').ok).toBe(false)
  })

  it('forgets a key on request, which is what a right answer earns', () => {
    const clock = aClock()
    const throttle = createThrottle({ attempts: 1, windowMs: 60_000, now: clock.now })
    throttle.take('a')

    throttle.forget('a')

    expect(throttle.take('a').ok).toBe(true)
  })

  it('holds no more keys than it is allowed, however many ask', () => {
    const clock = aClock()
    const throttle = createThrottle({ attempts: 5, windowMs: 60_000, now: clock.now, keys: 8 })

    for (let key = 0; key < 100; key += 1) throttle.take(`k-${key}`)

    expect(throttle.size()).toBeLessThanOrEqual(8)
  })

  it('reclaims a key whose window has passed rather than counting it against the bound', () => {
    const clock = aClock()
    const throttle = createThrottle({ attempts: 1, windowMs: 1000, now: clock.now, keys: 4 })
    for (const key of ['a', 'b', 'c']) throttle.take(key)

    clock.pass(1001)
    throttle.take('kept')
    throttle.take('other')

    expect(throttle.size()).toBe(2)
  })

  it('keeps letting somebody in once its own keys are being forgotten', () => {
    const clock = aClock()
    const throttle = createThrottle({ attempts: 1, windowMs: 60_000, now: clock.now, keys: 2 })

    for (let key = 0; key < 20; key += 1) {
      expect(throttle.take(`k-${key}`).ok, `k-${key}`).toBe(true)
    }
  })
})
