/**
 * A bounded concurrency gate with a waiting queue.
 *
 * `scrypt` costs ~230ms of CPU and 64 MiB and runs on libuv's threadpool — four
 * slots by default, shared with the file reads `@fastify/static` does. So an
 * unbounded route that hashes lets one anonymous client stall the SPA and the ICS
 * feed, not merely that route.
 *
 * The obvious guard is a hard cap that sheds anything over it, and that trades
 * one bad property for another: two sustained requests hold the cap and every
 * member's login is refused for as long as they are held, with nothing to wait
 * out. A permanent outage of the only way into the app, triggerable from a
 * laptop.
 *
 * So: queue instead of shed, with two bounds that keep it honest. At most
 * `slots` verifications run at once, so the threadpool is still protected. At
 * most `queue` callers wait, so the queue cannot itself become the memory
 * exhaustion. And a caller that waits longer than `timeoutMs` gives up with a
 * 429 rather than holding a connection indefinitely.
 *
 * Waiters are served first-in-first-out, which is the property that removes the
 * cliff: a member arriving during a flood joins the line rather than being
 * turned away, and an attacker holding requests open competes for the same
 * places rather than owning them.
 *
 * Not a rate limiter. It bounds concurrent *work*, not attempts per caller —
 * #57 is that, and it is what bounds password guessing.
 */

export interface GateOptions {
  /** Concurrent holders. Two leaves half the default threadpool for everything else. */
  slots: number
  /** Callers allowed to wait. Beyond this, `enter` refuses immediately. */
  queue: number
  /** How long a caller waits before giving up. */
  timeoutMs: number
  /** Injected so tests do not wait in real time. */
  setTimer?: (fn: () => void, ms: number) => { clear: () => void }
}

/**
 * The numbers, for every route that spends scrypt.
 *
 * Two slots leaves half the threadpool for everything else. Eight deep and five
 * seconds are sized for the expensive case rather than the usual one: a
 * successful login can spend *two* hashes, `verifyPassword` and then the
 * opportunistic re-hash, both inside the slot — which is exactly the state a
 * parameter raise puts every account into, so the worst case coincides with the
 * one time the queue is likely to be full.
 *
 * Measured rather than estimated: that login takes ~389ms against ~223ms in the
 * steady state, so eight deep at two at a time is ~1556ms, which five seconds
 * clears by about 3x.
 *
 * One instance, shared. Login is not the only caller — redemption hashes before
 * it checks whether the address is taken, so its refusal costs what a success
 * costs, and that refusal never spends the invite. Two gates of two slots would
 * spend all four threads between them, which is the thing being bounded.
 */
export const SCRYPT_GATE: GateOptions = { slots: 2, queue: 8, timeoutMs: 5000 }

/**
 * Why a caller did not get in.
 *
 * Distinguished because the two want different advice. `queue-full` means the
 * work in flight should clear shortly. `timed-out` means the caller already
 * waited the full timeout and the gate was saturated throughout — telling them
 * to come straight back sends a well-behaved client honouring `Retry-After`
 * into a hot loop against exactly the flood this exists to damp.
 */
export type Refusal = 'queue-full' | 'timed-out'

export type Admission = { ok: true; release: () => void } | { ok: false; reason: Refusal }

export interface Gate {
  /**
   * Take a slot, waiting if necessary.
   *
   * On success the caller **must** call `release` — do it in a `finally`, since
   * a leaked slot wedges the gate until the process restarts.
   */
  enter: () => Promise<Admission>
  /**
   * How long to tell a shed caller to wait, by why they were shed.
   *
   * `queue-full` was refused synchronously and waited for nothing, and the work
   * in flight clears shortly, so a second is about right. `timed-out` held on for
   * the whole window against a gate that stayed saturated — sending that caller
   * straight back turns a client politely honouring `Retry-After` into a hot
   * retry loop, adding churn under exactly the flood this exists to damp.
   *
   * On the gate rather than beside it, so the number is the window this gate was
   * actually built with: writing `'5'` out again would go quietly wrong the day
   * `timeoutMs` moved.
   */
  retryAfter: (reason: Refusal) => string
  /** For assertions and logging. */
  stats: () => { active: number; waiting: number }
}

const realTimer = (fn: () => void, ms: number) => {
  const handle = setTimeout(fn, ms)
  // `unref` so a pending wait cannot hold the process open at shutdown.
  handle.unref?.()
  return { clear: () => clearTimeout(handle) }
}

export const createGate = ({ slots, queue, timeoutMs, setTimer = realTimer }: GateOptions): Gate => {
  let active = 0
  const waiting: { admit: () => void; timer: { clear: () => void } }[] = []

  // Guards against a caller releasing twice, which would let `active` drift
  // below zero and quietly raise the real concurrency limit.
  const releaseOnce = () => {
    let released = false

    return () => {
      if (released) return
      released = true

      const next = waiting.shift()
      if (next === undefined) {
        active -= 1
        return
      }

      // The slot passes straight to the waiter: `active` stays where it is,
      // which is what keeps the count equal to the number of holders rather
      // than briefly dipping and letting a new arrival jump the queue.
      next.timer.clear()
      next.admit()
    }
  }

  return {
    stats: () => ({ active, waiting: waiting.length }),

    retryAfter: (reason) => (reason === 'timed-out' ? String(Math.ceil(timeoutMs / 1000)) : '1'),

    enter: async () => {
      if (active < slots) {
        active += 1
        return { ok: true, release: releaseOnce() }
      }

      if (waiting.length >= queue) return { ok: false, reason: 'queue-full' }

      return new Promise<Admission>((resolve) => {
        const entry = {
          admit: () => resolve({ ok: true, release: releaseOnce() }),
          timer: setTimer(() => {
            const index = waiting.indexOf(entry)
            if (index !== -1) waiting.splice(index, 1)
            resolve({ ok: false, reason: 'timed-out' })
          }, timeoutMs),
        }

        waiting.push(entry)
      })
    },
  }
}
