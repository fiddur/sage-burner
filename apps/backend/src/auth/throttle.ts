export interface Bound {
  attempts: number
  windowMs: number
}

export interface ThrottleOptions extends Bound {
  now: () => number
  keys?: number
}

export type Allowance = { ok: false; retryAfterSeconds: number } | { ok: true }

export interface Throttle {
  take: (key: string) => Allowance
  forget: (key: string) => void
  size: () => number
}

/**
 * Thirty a window per address is generous on purpose: everybody at a gathering shares one
 * public address, so a bound tight enough to stop a determined guesser from one machine would
 * lock a whole camp out. What it does bound is the CPU one client can ask for — every attempt
 * costs a full scrypt, whether or not the address exists.
 */
export const LOGIN_BY_IP: Bound = { attempts: 30, windowMs: 5 * 60_000 }

export const LOGIN_BY_ADDRESS: Bound = { attempts: 10, windowMs: 15 * 60_000 }

export const REDEEM_BY_IP: Bound = { attempts: 20, windowMs: 10 * 60_000 }

export const MOST_KEYS = 4096

export const createThrottle = ({ attempts, windowMs, now, keys = MOST_KEYS }: ThrottleOptions): Throttle => {
  const seen = new Map<string, { count: number; until: number }>()

  const makeRoom = (at: number) => {
    for (const [key, bucket] of seen) {
      if (bucket.until <= at) seen.delete(key)
    }

    // Still full means every bucket is live, which is a spread of addresses rather than a
    // burst from one. Forgetting the one closest to expiry keeps the map bounded; refusing
    // instead would turn a wide attack into an outage for everybody.
    while (seen.size >= keys) {
      const [oldest] = [...seen.entries()].sort((one, other) => one[1].until - other[1].until)
      if (oldest === undefined) return
      seen.delete(oldest[0])
    }
  }

  return {
    size: () => seen.size,

    forget: (key) => {
      seen.delete(key)
    },

    take: (key) => {
      const at = now()
      const held = seen.get(key)

      if (held === undefined || held.until <= at) {
        if (seen.size >= keys) makeRoom(at)
        seen.set(key, { count: 1, until: at + windowMs })

        return { ok: true }
      }

      if (held.count >= attempts) {
        return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((held.until - at) / 1000)) }
      }

      held.count += 1

      return { ok: true }
    },
  }
}
