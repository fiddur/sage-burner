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

    while (seen.size >= keys) {
      let soonest: string | undefined
      let earliest = Number.POSITIVE_INFINITY

      for (const [key, bucket] of seen) {
        if (bucket.until < earliest) {
          earliest = bucket.until
          soonest = key
        }
      }

      if (soonest === undefined) return
      seen.delete(soonest)
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
