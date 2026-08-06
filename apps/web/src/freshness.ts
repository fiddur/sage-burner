import { CACHED_AT } from './sw/cache.ts'

/**
 * How old what is on screen is (#256).
 *
 * The rule is deliberately literal: past five minutes the app says so, whatever the
 * reason. Online that is nearly unreachable, because the pages others change under
 * you refetch while the tab is watched — so the banner appearing means a refresh
 * genuinely could not land, which is exactly when somebody should not trust the
 * roster in front of them.
 */
export const FRESH_FOR_MS = 5 * 60_000

/**
 * When a response's data was actually fetched.
 *
 * The service worker stamps what it serves from its cache, so an answer that arrived
 * while offline says when it was true rather than when it was handed over. Anything
 * without the stamp came off the network just now.
 *
 * An unparseable stamp counts as now. It cannot happen — the worker writes an ISO
 * string — and treating it as ancient would put a permanent banner on the page over a
 * header nobody would think to look at.
 */
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

/**
 * Somewhere to keep the newest of those, that is not a module-level variable.
 *
 * Built once in `App` and handed to both the API client and the banner, so a test
 * gets its own rather than whatever the last one left behind.
 */
export const createFreshness = (): Freshness => {
  let latest: number | undefined
  const listeners = new Set<() => void>()

  return {
    latest: () => latest,

    note: (at) => {
      // Only ever forwards. A page loads several things at once and they finish in
      // whatever order they finish, so a cached answer landing after a live one must
      // not drag the age back with it.
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
