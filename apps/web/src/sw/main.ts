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
} from './cache.ts'

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
const freshFirst = async (event: SwFetchEvent, cacheName: string, key: Request | string) => {
  try {
    const response = await fetch(event.request)

    // Only a real answer is worth keeping. A 404 or a 500 cached here would be served
    // back for as long as the entry lived, long after the server stopped saying it.
    if (response.ok) {
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
  if (response.ok) event.waitUntil(put(SHELL_CACHE, event.request, response.clone()))

  return response
}

const navigation = async (event: SwFetchEvent) => {
  try {
    return await freshFirst(event, SHELL_CACHE, SHELL_KEY)
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
  if (cacheName !== undefined) event.respondWith(freshFirst(event, cacheName, event.request))
})

self.addEventListener('push', (event) => {
  // A payload that will not parse is still worth a notification: something
  // happened, and silence is the worse failure. The push service cannot read it —
  // it is encrypted to this browser's key — so a malformed one means our bug.
  let body = 'Something needs your attention.'
  try {
    const data = event.data === undefined ? undefined : event.data.json()
    if (typeof data === 'object' && data !== null && 'body' in data && typeof data.body === 'string') {
      body = data.body
    }
  } catch {
    // Keep the fallback.
  }

  event.waitUntil(
    self.registration.showNotification('Sage Burner', {
      body,
      // Collapses repeats: three applications while the phone is locked should be
      // one line to act on, not three identical ones to dismiss.
      tag: 'sage-burner-applications',
      data: { path: '/admin/applications' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const path = event.notification.data?.path ?? '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
      // Focus a tab that is already open rather than piling up new ones, which is
      // what happens on a phone otherwise.
      for (const client of windows) {
        if (client.url.endsWith(path)) return client.focus()
      }

      return self.clients.openWindow(path)
    }),
  )
})
