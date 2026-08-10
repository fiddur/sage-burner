import { CACHED_AT } from './sw/cache.ts'

export const FRESH_FOR_MS = 5 * 60_000

export const freshnessAt = (response: Pick<Response, 'headers'>, now: number): number => {
  const stamp = response.headers.get(CACHED_AT)
  if (stamp === null) return now

  const at = Date.parse(stamp)
  return Number.isNaN(at) ? now : at
}

export interface Freshness {
  latest: () => number | undefined
  note: (at: number) => void
  subscribe: (listener: () => void) => () => void
}

export const createFreshness = (): Freshness => {
  let latest: number | undefined
  const listeners = new Set<() => void>()

  return {
    latest: () => latest,

    note: (at) => {
      if (latest !== undefined && at <= latest) return

      latest = at
      for (const listener of listeners) listener()
    },

    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
