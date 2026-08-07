import type { CachePlan } from './cache.ts'

import {
  API_CACHE,
  ASSET_LIMIT,
  cacheFor,
  OFFLINE_PAGE,
  planFor,
  SHELL_CACHE,
  SHELL_KEY,
  stamped,
  trim,
  worthStoring,
} from './cache.ts'
import { alertFrom, HOME, ROUTE_TO } from './notification.ts'

/**
 * The service worker: push notifications (#248) and offline (#256).
 *
 * Bundled from TypeScript rather than hand-written into `public/`, which is where it
 * lived while it only handled push. The old file said in its own header that nothing
 * verified it and that caching must therefore stay out — true then, and the reason
 * this moved rather than grew. Every decision worth testing is in `cache.ts`; what is
 * left here is wiring to browser events, which a unit test could only restate.
 *
 * Vite emits it to `dist/sw.js`, at the site root, which is where a worker has to
 * live to claim `/` as its scope. `@fastify/static` serves everything outside
 * `assets/` as `no-cache`, so a redeploy replaces it rather than leaving browsers on
 * an old copy.
 *
 * The browser's own types for a worker global are in `lib.webworker`, which cannot be
 * loaded beside `lib.dom` — the app needs DOM, and the two redeclare each other. So
 * the parts used are declared here, in the same spirit as `push.ts`'s `PushBrowser`:
 * narrow enough to be honest about what is touched.
 */

interface ExtendableEvent {
  waitUntil: (work: Promise<unknown>) => void
}

interface SwFetchEvent extends ExtendableEvent {
  request: Request
  respondWith: (response: Promise<Response> | Response) => void
}

interface SwPushEvent extends ExtendableEvent {
  data?: { json: () => unknown }
}

interface SwNotificationEvent extends ExtendableEvent {
  notification: { close: () => void; data?: { path?: string } }
}

interface SwClient {
  focus: () => Promise<SwClient>
  postMessage: (message: unknown) => void
  url: string
}

interface WorkerScope {
  addEventListener: {
    (type: 'activate' | 'install', handler: (event: ExtendableEvent) => void): void
    (type: 'fetch', handler: (event: SwFetchEvent) => void): void
    (type: 'notificationclick', handler: (event: SwNotificationEvent) => void): void
    (type: 'push', handler: (event: SwPushEvent) => void): void
  }
  caches: CacheStorage
  clients: {
    claim: () => Promise<void>
    matchAll: (options: { includeUncontrolled: boolean; type: 'window' }) => Promise<SwClient[]>
    openWindow: (url: string) => Promise<SwClient | null>
  }
  location: { origin: string }
  registration: {
    showNotification: (title: string, options: Record<string, unknown>) => Promise<void>
  }
  skipWaiting: () => Promise<void>
}

declare const self: WorkerScope

/** Whether a window is already showing the page, ignoring any query or fragment. */
const showing = (client: SwClient, path: string, origin: string): boolean => {
  try {
    return new URL(client.url).pathname === new URL(path, origin).pathname
  } catch {
    return false
  }
}

// Take over straight away rather than waiting for every tab to close. A worker that
// only starts controlling pages on the next cold start would leave somebody who just
// installed the app with no offline support until they closed it.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

const put = async (cacheName: string, key: Request | string, response: Response) => {
  const cache = await self.caches.open(cacheName)
  await cache.put(key, response)

  if (cacheName === SHELL_CACHE) await trim(cache, ASSET_LIMIT)
}

const fromCache = async (cacheName: string, key: Request | string) => {
  const cache = await self.caches.open(cacheName)
  return cache.match(key)
}

/**
 * Try the network, fall back to what was stored.
 *
 * Network-first rather than cache-first for everything but hashed assets: what is on
 * screen should be what the server has whenever that is reachable at all. The stored
 * copy is a floor under being offline, not a way of being faster.
 */
const freshFirst = async (event: SwFetchEvent, plan: CachePlan, cacheName: string, key: Request | string) => {
  try {
    const response = await fetch(event.request)

    if (worthStoring(plan, response)) {
      const keep = cacheName === API_CACHE ? await stamped(response, new Date().toISOString()) : response
      event.waitUntil(put(cacheName, key, keep.clone()))
      return keep
    }

    return response
  } catch (offline) {
    const stored = await fromCache(cacheName, key)
    if (stored !== undefined) return stored
    throw offline
  }
}

const cacheFirst = async (event: SwFetchEvent) => {
  const stored = await fromCache(SHELL_CACHE, event.request)
  if (stored !== undefined) return stored

  const response = await fetch(event.request)
  if (worthStoring('asset', response)) {
    event.waitUntil(put(SHELL_CACHE, event.request, response.clone()))
  }

  return response
}

const navigation = async (event: SwFetchEvent) => {
  try {
    return await freshFirst(event, 'navigate', SHELL_CACHE, SHELL_KEY)
  } catch {
    return new Response(OFFLINE_PAGE, {
      status: 503,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }
}

self.addEventListener('fetch', (event) => {
  const plan = planFor(event.request, self.location.origin)
  if (plan === 'skip') return

  if (plan === 'navigate') return event.respondWith(navigation(event))
  if (plan === 'asset') return event.respondWith(cacheFirst(event))

  const cacheName = cacheFor(plan)
  if (cacheName !== undefined) event.respondWith(freshFirst(event, plan, cacheName, event.request))
})

const payloadOf = (event: SwPushEvent): unknown => {
  try {
    return event.data?.json()
  } catch {
    // A payload that will not parse is still worth a notification; `alertFrom`
    // answers with the wording that says so.
    return undefined
  }
}

self.addEventListener('push', (event) => {
  const alert = alertFrom(payloadOf(event))

  event.waitUntil(
    self.registration.showNotification('Sage Burner', {
      body: alert.body,
      tag: alert.tag,
      data: { path: alert.path },
    }),
  )
})

/**
 * Where a tap lands, in the order that costs somebody least (#279).
 *
 * A new window is the worst answer available and used to be the common one: the match
 * was a suffix of the whole URL, so an app open on `/meals` did not count as open for
 * anything else — including a notification naming no page at all, whose `/` a URL not
 * ending in a slash cannot end with. On a phone, where the worker belongs to the
 * browser rather than to the installed copy, that meant a browser tab instead of the
 * app that was already on screen.
 *
 * So: the window already showing it, else any window of ours asked to route in place,
 * else a new one. `postMessage` rather than `client.navigate()` — see `ROUTE_TO`. A
 * window loaded before this shipped has no listener for it and simply stays where it
 * is, which is still inside the app rather than beside it.
 *
 * Any window will do, and the first is taken rather than the focused one: `Client`
 * carries `focused` and `visibilityState`, but at one window per phone the difference
 * is not worth declaring more of the API than is touched.
 */
const landOn = async (path: string | undefined): Promise<unknown> => {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const [anywhere] = windows

  // No page of its own — a new version is everywhere. Any window of ours is already
  // the right one, and routing it would take somebody off what they were reading.
  if (path === undefined) {
    return anywhere === undefined ? self.clients.openWindow(HOME) : anywhere.focus()
  }

  const already = windows.find((client) => showing(client, path, self.location.origin))
  if (already !== undefined) return already.focus()

  if (anywhere === undefined) return self.clients.openWindow(path)

  await anywhere.focus()
  anywhere.postMessage({ type: ROUTE_TO, path })

  return anywhere
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  event.waitUntil(landOn(event.notification.data?.path))
})
