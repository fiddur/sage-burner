import type { ApiClient } from './api/client.ts'

export type VersionApi = Pick<ApiClient, 'getVersion'>

/**
 * How often to ask, at most. The tab coming back to the front asks as well, which is
 * what actually catches a redeploy: a phone in a pocket is not polling anything.
 */
export const CHECK_EVERY_MS = 60_000

/**
 * Whether the server is running a different build from the one this page loaded.
 *
 * The first answer is the baseline rather than anything built in — the bundle has no
 * idea what it was built from, and does not need one. What matters is only that the
 * server's answer *changed* while this tab stayed open, which is exactly what a
 * redeploy does.
 *
 * That works because of how the two halves are cached: the shell is `no-cache` and
 * everything under `assets/` is content-hashed and immutable, so a redeploy leaves
 * this tab running code that no longer exists on the server. Watchtower redeploys on
 * its own schedule, so this is the difference between somebody meeting a new version
 * and somebody meeting a stale one at a burn.
 *
 * A failed check answers `false`: being offline for a moment is not a new version,
 * and a reload prompt is the last thing somebody with no connection needs.
 */
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
  // Not `0`: the floor below would then suppress the very first check against any
  // clock starting at zero. Production escapes that only because epoch millis are
  // large, which is an accident rather than a reason.
  let lastAsked = Number.NEGATIVE_INFINITY
  let stopped = false

  const check = async () => {
    if (stopped || hidden()) return
    // The floor, so a tab flicked back and forth does not ask each time.
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
