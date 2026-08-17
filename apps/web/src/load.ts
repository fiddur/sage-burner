import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

import type { FormErrorState } from './components/FormError.tsx'

import { isApiError } from './api/client.ts'
import { useRemembered } from './remembered.tsx'
import { useShown } from './shown.tsx'
import { isStale } from './stale.ts'
import { useViewer } from './viewer.tsx'

export const REVALIDATE_EVERY_MS = 60_000

export type Loaded<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'failed'; message: string }

export const errorMessage = (failure: unknown, fallback: string) =>
  isApiError(failure) ? failure.message : fallback

const whereWeAre = () => `${globalThis.location?.pathname ?? ''}${globalThis.location?.search ?? ''}`

export const useLoad = <T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  {
    enabled = true,
    key = '',
    fallback = 'Could not load that.',
    live = false,
    remember,
  }: { enabled?: boolean; fallback?: string; key?: string; live?: boolean; remember?: string },
): { loaded: Loaded<T>; refreshing: boolean; reload: () => Promise<void> } => {
  const remembered = useRemembered()
  const shown = useShown()
  const signedIn = useViewer().status === 'signed-in'
  const at = remember === undefined ? undefined : `${remember}:${key}`

  const recall = (): Loaded<T> => {
    const held = at === undefined ? undefined : remembered.read<T>(at)
    return held === undefined ? { status: 'loading' } : { status: 'ready', data: held }
  }

  const [loaded, setLoaded] = useState<Loaded<T>>(recall)
  const [fetching, setFetching] = useState(false)
  const seeded = useRef(at)
  const [attempt, setAttempt] = useState({ count: 0, quiet: false })

  const latest = useRef(fetcher)
  latest.current = fetcher

  const waiting = useRef<(() => void)[]>([])
  const settle = () => {
    const pending = waiting.current
    waiting.current = []
    for (const done of pending) done()
  }

  useEffect(() => {
    if (!enabled) {
      settle()
      return undefined
    }

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
        if (signedIn) shown.report(whereWeAre(), controller.signal)
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return

        setLoaded((current) =>
          attempt.quiet && current.status === 'ready'
            ? current
            : { status: 'failed', message: errorMessage(failure, fallback) },
        )
      })
      .finally(() => {
        if (controller.signal.aborted) return
        setFetching(false)
        settle()
      })

    return () => {
      controller.abort()
    }
  }, [enabled, attempt, at, key, fallback, remembered, shown, signedIn])

  useEffect(() => {
    if (!live || !enabled) return undefined

    const refresh = () => {
      if (globalThis.document?.visibilityState === 'hidden') return
      setAttempt(({ count }) => ({ count: count + 1, quiet: true }))
    }

    const timer = setInterval(refresh, REVALIDATE_EVERY_MS)
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
    refreshing: fetching && loaded.status === 'ready',
    reload: useCallback(
      () =>
        new Promise<void>((resolve) => {
          waiting.current.push(resolve)
          setAttempt(({ count }) => ({ count: count + 1, quiet: false }))
        }),
      [],
    ),
  }
}

export const useAction = (onSuccess?: () => void | Promise<void>) => {
  const [active, setActive] = useState<{ tag: string | undefined } | undefined>(undefined)
  const [problem, setProblem] = useState<{ message?: string; failure?: unknown; attempt: number }>({
    attempt: 0,
  })
  const busy = active !== undefined

  const run = (
    work: () => Promise<unknown>,
    fallback: string | ((failure: unknown) => string),
    tag?: string,
  ) => {
    if (busy) return

    setActive({ tag })
    setProblem(({ attempt }) => ({ attempt: attempt + 1 }))

    void work()
      .then(() => onSuccess?.())
      .catch((failure: unknown) => {
        setProblem(({ attempt }) => ({
          message: typeof fallback === 'function' ? fallback(failure) : errorMessage(failure, fallback),
          failure,
          attempt: attempt + 1,
        }))

        if (isStale(failure)) return onSuccess?.()

        return undefined
      })
      .finally(() => {
        setActive(undefined)
      })
  }

  return {
    busy,
    busyWith: active?.tag,
    error: problem.message,
    failure: problem.failure,
    formError: { message: problem.message, attempt: problem.attempt } satisfies FormErrorState,
    setError: (message: string | undefined) => {
      setProblem(({ attempt }) => ({ message, attempt: attempt + 1 }))
    },
    run,
  }
}

export const useLoadInto = <T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  seed: (data: T) => void,
  options: { enabled?: boolean; fallback?: string; key?: string },
): { loaded: Loaded<T>; refreshing: boolean; reload: () => Promise<void> } => {
  const { loaded, refreshing, reload } = useLoad(fetcher, options)
  const latest = useRef(seed)
  latest.current = seed

  useEffect(() => {
    if (loaded.status === 'ready') latest.current(loaded.data)
  }, [loaded])

  return { loaded, refreshing, reload }
}
