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

    expect((await gate.enter()).ok).toBe(true)
    expect((await gate.enter()).ok).toBe(true)
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

    if (first.ok) first.release()
    expect((await queued).ok).toBe(true)
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

    if (held.ok) held.release()
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
    // Named, not merely refused: a full queue clears shortly, so the caller is
    // told to come back in a second rather than after the full window.
    expect(await gate.enter()).toEqual({ ok: false, reason: 'queue-full' })
  })

  it('gives up on a caller that has waited too long', async () => {
    const timers = controllableTimers()
    const gate = gateWith({ slots: 1, setTimer: timers.setTimer })
    await gate.enter()

    const queued = gate.enter()
    timers.expireAll()

    // Distinguished from queue-full: this caller already waited the whole
    // window against a saturated gate, so sending them straight back would be
    // a hot retry loop under exactly the flood the gate damps.
    expect(await queued).toEqual({ ok: false, reason: 'timed-out' })
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
    expect((await abandoned).ok).toBe(false)

    if (held.ok) held.release()
    expect(gate.stats()).toEqual({ active: 0, waiting: 0 })
    expect((await gate.enter()).ok).toBe(true)
  })

  it('ignores a double release, which would otherwise raise the real limit', async () => {
    const gate = gateWith({ slots: 1 })
    const admission = await gate.enter()
    if (!admission.ok) throw new Error('expected admission')

    admission.release()
    admission.release()

    expect(gate.stats().active).toBe(0)
  })

  it('frees every slot again after a burst, so the gate cannot wedge shut', async () => {
    const gate = gateWith({ slots: 2, queue: 8 })

    const admitted = await Promise.all([gate.enter(), gate.enter()])
    const queued = [gate.enter(), gate.enter()]
    for (const entry of admitted) if (entry.ok) entry.release()
    for (const entry of await Promise.all(queued)) if (entry.ok) entry.release()

    expect(gate.stats()).toEqual({ active: 0, waiting: 0 })
  })

  describe('what it tells a shed caller to wait', () => {
    it('derives the timed-out advice from its own window', () => {
      // Written out as `'5'`, this went quietly wrong the day `timeoutMs` moved:
      // a caller who waited eight seconds told to come back in five is the hot
      // retry loop the number exists to prevent.
      expect(createGate({ slots: 1, queue: 1, timeoutMs: 8000 }).retryAfter('timed-out')).toBe('8')
      expect(createGate({ slots: 1, queue: 1, timeoutMs: 2500 }).retryAfter('timed-out')).toBe('3')
    })

    it('tells a queue-full caller one second, whatever the window is', () => {
      // They waited for nothing — the work in flight is what clears, and that is
      // a slot's worth away rather than a window's.
      expect(createGate({ slots: 1, queue: 1, timeoutMs: 8000 }).retryAfter('queue-full')).toBe('1')
    })
  })
})
