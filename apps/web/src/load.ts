import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

import { isApiError } from './api/client.ts'

/**
 * The load–mutate–reload skeleton every page was hand-rolling.
 *
 * Fifteen files carried the same tagged union and fetch-on-mount block in three
 * accidental variants, and nine carried the same busy/error/try-catch wrapper. The
 * drift was the argument for collapsing them, not the line count: one page's
 * `Loaded` had dropped the failure message entirely, so its load errors rendered as
 * a blank screen, and only one of the four identical `run` copies guarded against a
 * double click.
 */

/**
 * How often a `live` page refetches while somebody is looking at it.
 *
 * A minute, which is the same beat `version.ts` checks for a redeploy on and well
 * inside the five minutes past which the app calls what is on screen stale — so an
 * open tab reaches that state only when a refresh could not land.
 */
export const REVALIDATE_EVERY_MS = 60_000

export type Loaded<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'failed'; message: string }

/**
 * What to show a member when a call failed.
 *
 * `ApiError` already carries a message meant for them — `messageFor` in the client
 * maps the status — so the fallback is only for a failure that never reached the
 * mapping: a bug in the caller, or something thrown that is not an error at all.
 */
export const errorMessage = (failure: unknown, fallback: string) =>
  isApiError(failure) ? failure.message : fallback

/**
 * Fetch on mount, and again on `reload()`.
 *
 * `enabled` is for the pages gated on a role: they must not fetch while the viewer
 * is still resolving, and must not fetch at all for somebody who will be shown the
 * sign-in copy instead. It re-runs when it flips, so a viewer that resolves to a
 * member loads without the page having to say so.
 *
 * `key` is for what the fetcher is *about*, which the fetcher itself cannot say —
 * it lives in a ref precisely so that a new closure does not refetch. Every
 * burn-scoped page passes the selected burn's id, so changing the selector reloads
 * the page rather than leaving one burn's grid on screen under another's name.
 *
 * The fetcher is called with an `AbortSignal` and its result is dropped if that
 * signal fired — a page navigated away from mid-request must not write to state it
 * no longer owns, and a cancellation is housekeeping rather than a failure to
 * report.
 *
 * Deliberately not a cache: every mutation re-reads. One extra request per change
 * buys "what is on screen is what the server has", including the values the server
 * assigned, and at this size there is nothing to gain by being cleverer.
 *
 * `live` is for the pages several people change at once — the grid, the roster, the
 * lists of who is doing what. They refetch on a timer and whenever the tab comes
 * back to the front, so what is on screen keeps up with whoever else is editing it
 * (#256). Off by default: most pages are somebody's own record or an admin workflow,
 * where a background refetch is a request for nothing.
 */
export const useLoad = <T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  {
    enabled = true,
    key = '',
    fallback,
    live = false,
  }: { enabled?: boolean; fallback: string; key?: string; live?: boolean },
): { loaded: Loaded<T>; reload: () => void } => {
  const [loaded, setLoaded] = useState<Loaded<T>>({ status: 'loading' })
  // The kind travels with the count, so the effect that reacts to it knows whether a
  // failure is worth replacing the page with. A ref would be read after the state
  // that triggered the run had already changed it.
  const [attempt, setAttempt] = useState({ count: 0, quiet: false })

  // Held in a ref so the effect does not re-run for a fetcher rebuilt on every
  // render. Callers write `() => api.getThing(signal)` inline, which is a new
  // function each time; depending on it would refetch in a loop, and asking every
  // caller for a `useCallback` would be a rule to remember rather than a default
  // that holds.
  const latest = useRef(fetcher)
  latest.current = fetcher

  useEffect(() => {
    if (!enabled) return undefined

    const controller = new AbortController()

    latest
      .current(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setLoaded({ status: 'ready', data })
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return

        setLoaded((current) =>
          // A refetch nobody asked for must not take the page away. Offline the
          // worker answers most of these from its cache, but the first load after an
          // install is not controlled by it yet — and replacing a good roster with
          // "could not load" because a background poll missed would be a worse page
          // than the one it started with. The staleness bar is what says so instead.
          attempt.quiet && current.status === 'ready'
            ? current
            : { status: 'failed', message: errorMessage(failure, fallback) },
        )
      })

    return () => {
      controller.abort()
    }
  }, [enabled, attempt, key, fallback])

  useEffect(() => {
    if (!live || !enabled) return undefined

    const refresh = () => {
      // A tab in the background is not being read, and a phone in a pocket polling
      // every minute is somebody's battery.
      if (globalThis.document?.visibilityState === 'hidden') return
      setAttempt(({ count }) => ({ count: count + 1, quiet: true }))
    }

    const timer = setInterval(refresh, REVALIDATE_EVERY_MS)
    // Coming back to the tab is what actually catches up after a while away; the
    // interval only covers a tab somebody is sitting in front of.
    globalThis.addEventListener('visibilitychange', refresh)
    globalThis.addEventListener('focus', refresh)

    return () => {
      clearInterval(timer)
      globalThis.removeEventListener('visibilitychange', refresh)
      globalThis.removeEventListener('focus', refresh)
    }
  }, [live, enabled])

  return {
    loaded,
    reload: useCallback(() => setAttempt(({ count }) => ({ count: count + 1, quiet: false })), []),
  }
}

/**
 * Run a mutation, with the busy flag and the error message that go with it.
 *
 * `run` refuses to start while one is in flight. That was true of one of the four
 * copies this replaces and not the others, so a double click on those sent the
 * request twice — made one deliberate choice here rather than four accidental ones.
 *
 * The fallback may be a function, for the pages that map a particular status to
 * particular words: a 409 on "say you are coming" means the burn is full, which is
 * worth saying rather than "that did not work".
 */
export const useAction = (onSuccess?: () => void) => {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const run = (work: () => Promise<unknown>, fallback: string | ((failure: unknown) => string)) => {
    if (busy) return

    setBusy(true)
    setError(undefined)

    void work()
      .then(() => {
        onSuccess?.()
      })
      .catch((failure: unknown) => {
        setError(typeof fallback === 'function' ? fallback(failure) : errorMessage(failure, fallback))
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return { busy, error, setError, run }
}
