/**
 * A bounded concurrency gate with a waiting queue.
 *
 * Password verification costs ~230ms of CPU and 64 MiB, and `scrypt` runs on
 * libuv's threadpool — four slots by default, shared with the file reads
 * `@fastify/static` does. So an unbounded login route lets one anonymous client
 * stall the SPA and the ICS feed, not merely login.
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

export interface Gate {
  /**
   * Take a slot, waiting if necessary.
   *
   * Resolves to a release function, or `undefined` if the queue was full or the
   * wait timed out. The caller **must** call the release function — do it in a
   * `finally`, since a leaked slot wedges the gate until the process restarts.
   */
  enter: () => Promise<(() => void) | undefined>
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

    enter: async () => {
      if (active < slots) {
        active += 1
        return releaseOnce()
      }

      if (waiting.length >= queue) return undefined

      return new Promise<(() => void) | undefined>((resolve) => {
        const entry = {
          admit: () => resolve(releaseOnce()),
          timer: setTimer(() => {
            const index = waiting.indexOf(entry)
            if (index !== -1) waiting.splice(index, 1)
            resolve(undefined)
          }, timeoutMs),
        }

        waiting.push(entry)
      })
    },
  }
}
