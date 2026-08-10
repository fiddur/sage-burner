import type { ApiClient } from './api/client.ts'

export type VersionApi = Pick<ApiClient, 'getVersion'>

export const CHECK_EVERY_MS = 60_000

export const watchForNewVersion = (
  api: VersionApi,
  onNewVersion: () => void,
  {
    now = () => Date.now(),
    listen = (name: string, handler: () => void) => {
      globalThis.addEventListener(name, handler)
      return () => globalThis.removeEventListener(name, handler)
    },
    hidden = () => globalThis.document?.visibilityState === 'hidden',
  } = {},
): (() => void) => {
  let loaded: string | undefined
  let lastAsked = Number.NEGATIVE_INFINITY
  let stopped = false

  const check = async () => {
    if (stopped || hidden()) return
    if (now() - lastAsked < CHECK_EVERY_MS) return

    lastAsked = now()

    let build: string
    try {
      build = (await api.getVersion()).build_sha
    } catch {
      return
    }

    if (stopped) return
    if (loaded === undefined) {
      loaded = build
      return
    }

    if (build !== loaded) onNewVersion()
  }

  void check()

  const timer = setInterval(() => void check(), CHECK_EVERY_MS)
  const unlisten = [listen('visibilitychange', () => void check()), listen('focus', () => void check())]

  return () => {
    stopped = true
    clearInterval(timer)
    for (const off of unlisten) off()
  }
}
