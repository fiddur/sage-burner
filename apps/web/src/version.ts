import type { ApiClient } from './api/client.ts'

import { ROUTER_SCOPE } from './router-scope.ts'

export type VersionApi = Pick<ApiClient, 'getVersion'>

export const CHECK_EVERY_MS = 60_000

const inApp = (link: HTMLAnchorElement, scope: RegExp): boolean =>
  link.origin === globalThis.location.origin &&
  !link.getAttribute('href')?.startsWith('#') &&
  link.download === '' &&
  (link.target === '' || link.target === '_self') &&
  scope.test(link.pathname)

/**
 * `preact-iso` claims every in-app link and pushes state instead, which is what leaves this tab
 * on the build the bar is complaining about. The listener runs at capture, before the router's.
 */
export const hardenNavigation = (
  go: (href: string) => void = (href) => globalThis.location.assign(href),
  scope: RegExp = ROUTER_SCOPE,
): (() => void) => {
  const onClick = (event: MouseEvent) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return

    const link = event
      .composedPath()
      .find((step): step is HTMLAnchorElement => step instanceof HTMLAnchorElement)
    if (link === undefined || !inApp(link, scope)) return

    event.preventDefault()
    go(link.href)
  }

  globalThis.addEventListener('click', onClick, { capture: true })

  return () => globalThis.removeEventListener('click', onClick, { capture: true })
}

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
