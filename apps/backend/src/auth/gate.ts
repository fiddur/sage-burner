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

/**
 * Bounds on concurrent scrypt, wherever it is spent.
 *
 * `scrypt` costs ~230ms and 64 MiB and runs on libuv's threadpool — four slots
 * by default, shared with the file reads `@fastify/static` does. Two leaves
 * half the pool for everything else.
 *
 * Queued rather than shed, which matters more than the numbers. A hard cap
 * means two sustained anonymous requests refuse every member's login for as
 * long as they are held, with nothing to wait out — a permanent outage of the
 * only way into the app, triggerable from a laptop. A FIFO queue keeps the same
 * threadpool bound while letting a member arriving mid-flood take their turn.
 *
 * The queue is bounded so it cannot become the exhaustion it prevents, and the
 * wait is bounded so a caller is answered rather than held open.
 *
 * The timeout is sized for the expensive case rather than the usual one. A
 * successful login can spend *two* hashes, not one — `verifyPassword` and then
 * `hashPassword` for the opportunistic upgrade — and both are inside the slot,
 * because the release is in the route's `finally`. That is precisely the state
 * a parameter raise puts every account into, so the worst case coincides with
 * the one time the queue is likely to be at full depth.
 *
 * Measured, not estimated: a login verifying against the previous OWASP rung
 * and re-hashing to the current one takes ~389ms, against ~223ms in the steady
 * state. Eight deep at two at a time is four turns, so ~1556ms — which a 2s
 * timeout clears by 22%, and a container slower than this machine does not. At
 * 5s the margin is ~3x. The cost of the longer wait is a held connection, which
 * is cheaper than refusing someone who typed the right password.
 *
 * Login is not the only caller. Redemption hashes before it checks whether the
 * address is already taken, so its refusal costs what a success costs — and that
 * refusal never spends the token, so a held invite can be replayed at it. One
 * gate covers both, because what is bounded is the threadpool, not the route.
 *
 * Still not a rate limiter: this bounds concurrent work, not attempts per
 * caller. #57 is that, and it is what bounds guessing.
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

/**
 * How long to tell a shed caller to wait, by why they were shed.
 *
 * `queue-full` was refused synchronously and waited for nothing, and the work in
 * flight clears shortly, so a second is about right. `timed-out` held on for the
 * whole window against a gate that stayed saturated — sending that caller
 * straight back turns a client politely honouring `Retry-After` into a hot retry
 * loop, adding churn under exactly the flood the gate exists to damp.
 *
 * Here rather than at each route: two callers writing the same two numbers out is
 * two places for a later change to reach only one of.
 */
export const retryAfterFor = (reason: Refusal): string => (reason === 'timed-out' ? '5' : '1')

export type Admission = { ok: true; release: () => void } | { ok: false; reason: Refusal }

export interface Gate {
  /**
   * Take a slot, waiting if necessary.
   *
   * On success the caller **must** call `release` — do it in a `finally`, since
   * a leaked slot wedges the gate until the process restarts.
   */
  enter: () => Promise<Admission>
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
