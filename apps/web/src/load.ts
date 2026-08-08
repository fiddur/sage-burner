import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

import type { FormErrorState } from './components/FormError.tsx'

import { isApiError } from './api/client.ts'
import { useRemembered } from './remembered.tsx'
import { isStale } from './stale.ts'

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
 *
 * `remember` names this call site in the store `Remembered` holds, and turns coming
 * back to a page from "Loading…" into last time's data with `refreshing` set. The
 * name is spelled out rather than derived because two loads on one page would
 * otherwise collide silently, and the burn's id joins it so switching burns is not
 * shown one burn's grid under the other's name.
 *
 * `fallback` is optional because a page that writes its own sentence for a failed load
 * never renders `loaded.message`. Absent in the type rather than present as a string
 * saying it is never shown — which is a string a member would see the day somebody did
 * render it. Named rather than counted: the list of such pages was already four the day
 * it was written down as two.
 */
export const useLoad = <T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  {
    enabled = true,
    key = '',
    fallback = 'Could not load that.',
    live = false,
    remember,
  }: { enabled?: boolean; fallback?: string; key?: string; live?: boolean; remember?: string },
): { loaded: Loaded<T>; refreshing: boolean; reload: () => void } => {
  const remembered = useRemembered()
  const at = remember === undefined ? undefined : `${remember}:${key}`

  const recall = (): Loaded<T> => {
    const held = at === undefined ? undefined : remembered.read<T>(at)
    return held === undefined ? { status: 'loading' } : { status: 'ready', data: held }
  }

  const [loaded, setLoaded] = useState<Loaded<T>>(recall)
  const [fetching, setFetching] = useState(false)
  // What the state above was seeded from, so a `key` change re-seeds and a refetch
  // does not. Without it every poll would replace `loaded` with an equal object.
  const seeded = useRef(at)
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

    if (seeded.current !== at) {
      seeded.current = at
      setLoaded(recall())
    }

    const controller = new AbortController()
    setFetching(true)

    latest
      .current(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return

        if (at !== undefined) remembered.write(at, data)
        setLoaded({ status: 'ready', data })
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
      .finally(() => {
        if (!controller.signal.aborted) setFetching(false)
      })

    return () => {
      controller.abort()
    }
  }, [enabled, attempt, at, key, fallback, remembered])

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
    // Only ever true over data: a first load has "Loading…" to say so, and a spinner
    // beside it would be two ways of saying one thing.
    refreshing: fetching && loaded.status === 'ready',
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
 *
 * `failure` is what was thrown, for the pages that want more from it than a sentence
 * — today the longer fields, which show what the other author wrote (#274). Held
 * beside the message rather than derived from it, so `setError` writing a message of
 * the page's own clears it.
 *
 * `formError` is the same message counted, for a form tall enough that the complaint
 * must be beside the button and focused rather than at the top of the page — see
 * `FormError`, whose whole point is that a *repeated identical* failure is still a new
 * event. Four pages held a `useFormError` beside their own save loop for that, which is
 * two error states on one page and two chances to clear only one of them.
 */
export const useAction = (onSuccess?: () => void) => {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<{ message?: string; failure?: unknown; attempt: number }>({
    attempt: 0,
  })

  const run = (work: () => Promise<unknown>, fallback: string | ((failure: unknown) => string)) => {
    if (busy) return

    setBusy(true)
    setProblem(({ attempt }) => ({ attempt: attempt + 1 }))

    void work()
      .then(() => {
        onSuccess?.()
      })
      .catch((failure: unknown) => {
        setProblem(({ attempt }) => ({
          message: typeof fallback === 'function' ? fallback(failure) : errorMessage(failure, fallback),
          failure,
          attempt: attempt + 1,
        }))

        // A refused write leaves the page holding exactly the version that was
        // refused, so re-read: the message says it has been refreshed, and that has
        // to be true by the time somebody reads it. `onSuccess` is the reload on
        // every page that has one, which is every page with a guarded write.
        if (isStale(failure)) onSuccess?.()
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return {
    busy,
    error: problem.message,
    failure: problem.failure,
    /** The same message, for `FormError` — which counts attempts rather than storing one. */
    formError: { message: problem.message, attempt: problem.attempt } satisfies FormErrorState,
    setError: (message: string | undefined) => {
      setProblem(({ attempt }) => ({ message, attempt: attempt + 1 }))
    },
    run,
  }
}

/**
 * The pages whose "ready" is a form rather than a rendering.
 *
 * `Your details` and `Settings` both fetch a record and then copy it into the fields
 * somebody edits, so the response is a *seed* and the draft is what the page holds
 * from then on. Written out by hand that is `useLoad`'s effect plus a second one, and
 * the two pages had already grown different opinions about which state the failure
 * lived in — which is the drift #144 was filed about, so it is decided once here
 * rather than twice differently.
 *
 * `seed` runs once per answer, not once per render, and is held in a ref so a caller
 * can write it inline — the same reason `useLoad` holds its fetcher in one. It runs
 * again after a `reload()`, which is what makes a save show what the server kept.
 *
 * **Neither `live` nor `remember`**, and for one reason: both re-seed without anybody
 * asking, and a seed lands in the fields somebody is typing in. `live` polls in the
 * background; `remember` is quieter and worse — `useLoad` starts `ready` from the
 * remembered value, so the form seeds from it and again from the fetch a moment later,
 * with a keystroke possibly in between. Refused in the type rather than in a paragraph,
 * so it cannot be passed by somebody who has not read this one.
 */
export const useLoadInto = <T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  seed: (data: T) => void,
  options: { enabled?: boolean; fallback?: string; key?: string },
): { loaded: Loaded<T>; refreshing: boolean; reload: () => void } => {
  const { loaded, refreshing, reload } = useLoad(fetcher, options)
  const latest = useRef(seed)
  latest.current = seed

  useEffect(() => {
    if (loaded.status === 'ready') latest.current(loaded.data)
  }, [loaded])

  return { loaded, refreshing, reload }
}
