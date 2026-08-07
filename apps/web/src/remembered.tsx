import type { ComponentChildren } from 'preact'

import { createContext } from 'preact'
import { useContext } from 'preact/hooks'

/**
 * What the app has already loaded once, so leaving a page and coming back does not
 * start from "Loading…" (#256).
 *
 * The service worker's cache is on disk and answers a request; this is in memory and
 * answers a *render*. They solve different halves: offline the worker is what has the
 * roster at all, but even online, network-first means every navigation waits a round
 * trip before it has anything to draw. What was on screen a moment ago is a better
 * first frame than an empty one, and the fetch that follows replaces it.
 *
 * Held in a context and built in `App` rather than in a module, for the reason
 * `Freshness` is: two suites in one process would otherwise share one, and the second
 * would start out believing the first one's pages were its own.
 */
export interface Remembered {
  read: <T>(at: string) => T | undefined
  write: (at: string, data: unknown) => void
  forget: () => void
}

/**
 * The one cast in here, and the same trade `client.ts` makes on `JSON.parse`.
 *
 * A store several pages share cannot be typed per entry — the value is whatever the
 * page that wrote it had. The key names the call site, so the only way to read a `T`
 * that was never written as one is to spell two different pages' keys the same.
 */
export const createRemembered = (): Remembered => {
  const held = new Map<string, unknown>()

  return {
    read: <T,>(at: string) => held.get(at) as T | undefined,
    write: (at, data) => {
      held.set(at, data)
    },
    forget: () => {
      held.clear()
    },
  }
}

/**
 * What a tree with no provider gets: a store that remembers nothing.
 *
 * Stateless, so it is a constant rather than the module-level mutable state the rest
 * of this file exists to avoid. Every page still works — it just loads the way it did
 * before this, which is what a test that has not asked for the behaviour wants.
 */
const REMEMBERS_NOTHING: Remembered = {
  read: () => undefined,
  write: () => undefined,
  forget: () => undefined,
}

const RememberedContext = createContext<Remembered>(REMEMBERS_NOTHING)

export const RememberedProvider = ({
  children,
  remembered,
}: {
  children: ComponentChildren
  remembered: Remembered
}) => <RememberedContext.Provider value={remembered}>{children}</RememberedContext.Provider>

export const useRemembered = () => useContext(RememberedContext)
