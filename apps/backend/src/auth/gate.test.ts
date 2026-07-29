import { describe, expect, it } from 'vitest'

import { createGate } from './gate.ts'

/**
 * Timers are injected, so nothing here waits in real time — a suite that slept
 * for a two-second timeout would be a suite nobody runs.
 */

const controllableTimers = () => {
  const pending: { fn: () => void; cleared: boolean }[] = []

  return {
    setTimer: (fn: () => void) => {
      const entry = { fn, cleared: false }
      pending.push(entry)
      return {
        clear: () => {
          entry.cleared = true
        },
      }
    },
    /** Fire every timer that has not been cleared. */
    expireAll: () => {
      for (const entry of pending) if (!entry.cleared) entry.fn()
    },
  }
}

const gateWith = (overrides: Partial<Parameters<typeof createGate>[0]> = {}) =>
  createGate({ slots: 2, queue: 4, timeoutMs: 1000, ...overrides })

describe('createGate', () => {
  it('admits up to the slot count immediately', async () => {
    const gate = gateWith()

    expect(await gate.enter()).toBeTypeOf('function')
    expect(await gate.enter()).toBeTypeOf('function')
    expect(gate.stats()).toEqual({ active: 2, waiting: 0 })
  })

  it('queues the next caller rather than refusing it', async () => {
    // The whole point. A hard cap would refuse here, which turns two sustained
    // requests into a permanent outage of the only way into the app.
    const gate = gateWith()
    const first = await gate.enter()
    await gate.enter()

    const queued = gate.enter()
    expect(gate.stats()).toEqual({ active: 2, waiting: 1 })

    first?.()
    expect(await queued).toBeTypeOf('function')
  })

  it('serves waiters first in, first out', async () => {
    // Fairness is what removes the cliff: a member arriving during a flood
    // joins the line instead of being turned away, and a client holding
    // requests open competes for places rather than owning them.
    const gate = gateWith({ slots: 1 })
    const held = await gate.enter()

    const order: string[] = []
    const a = gate.enter().then(() => order.push('a'))
    void gate.enter().then(() => order.push('b'))

    held?.()
    await a
    expect(order).toEqual(['a'])

    // `a` never released, so `b` is still waiting — releasing the slot `a` took
    // is what lets it through.
    expect(gate.stats().waiting).toBe(1)
  })

  it('refuses once the queue is full, rather than growing without bound', async () => {
    // The queue must not become the exhaustion it exists to prevent.
    const gate = gateWith({ slots: 1, queue: 2 })
    await gate.enter()
    void gate.enter()
    void gate.enter()

    expect(gate.stats()).toEqual({ active: 1, waiting: 2 })
    expect(await gate.enter()).toBeUndefined()
  })

  it('gives up on a caller that has waited too long', async () => {
    const timers = controllableTimers()
    const gate = gateWith({ slots: 1, setTimer: timers.setTimer })
    await gate.enter()

    const queued = gate.enter()
    timers.expireAll()

    expect(await queued).toBeUndefined()
    expect(gate.stats().waiting).toBe(0)
  })

  it('does not admit a caller whose wait already timed out', async () => {
    // Otherwise a release hands the slot to someone who has gone, and it is
    // held until they release it — which they never will.
    const timers = controllableTimers()
    const gate = gateWith({ slots: 1, setTimer: timers.setTimer })
    const held = await gate.enter()

    const abandoned = gate.enter()
    timers.expireAll()
    expect(await abandoned).toBeUndefined()

    held?.()
    expect(gate.stats()).toEqual({ active: 0, waiting: 0 })
    expect(await gate.enter()).toBeTypeOf('function')
  })

  it('ignores a double release, which would otherwise raise the real limit', async () => {
    const gate = gateWith({ slots: 1 })
    const release = await gate.enter()

    release?.()
    release?.()

    expect(gate.stats().active).toBe(0)
  })

  it('frees every slot again after a burst, so the gate cannot wedge shut', async () => {
    const gate = gateWith({ slots: 2, queue: 8 })

    const releases = await Promise.all([gate.enter(), gate.enter()])
    const queued = [gate.enter(), gate.enter()]
    for (const release of releases) release?.()
    for (const release of await Promise.all(queued)) release?.()

    expect(gate.stats()).toEqual({ active: 0, waiting: 0 })
  })
})
