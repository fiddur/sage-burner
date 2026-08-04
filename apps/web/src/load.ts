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
 * The fetcher is called with an `AbortSignal` and its result is dropped if that
 * signal fired — a page navigated away from mid-request must not write to state it
 * no longer owns, and a cancellation is housekeeping rather than a failure to
 * report.
 *
 * Deliberately not a cache: every mutation re-reads. One extra request per change
 * buys "what is on screen is what the server has", including the values the server
 * assigned, and at this size there is nothing to gain by being cleverer.
 */
export const useLoad = <T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  { enabled = true, fallback }: { enabled?: boolean; fallback: string },
): { loaded: Loaded<T>; reload: () => void } => {
  const [loaded, setLoaded] = useState<Loaded<T>>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

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
        if (!controller.signal.aborted) {
          setLoaded({ status: 'failed', message: errorMessage(failure, fallback) })
        }
      })

    return () => {
      controller.abort()
    }
  }, [enabled, attempt, fallback])

  return { loaded, reload: useCallback(() => setAttempt((count) => count + 1), []) }
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
