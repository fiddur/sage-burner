import type { CachePlan } from './cache.ts'
import type { WindowClients } from './notification.ts'

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
import { alertFrom, landOn } from './notification.ts'

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

interface WorkerScope {
  addEventListener: {
    (type: 'activate' | 'install', handler: (event: ExtendableEvent) => void): void
    (type: 'fetch', handler: (event: SwFetchEvent) => void): void
    (type: 'notificationclick', handler: (event: SwNotificationEvent) => void): void
    (type: 'push', handler: (event: SwPushEvent) => void): void
  }
  caches: CacheStorage
  clients: WindowClients & { claim: () => Promise<void> }
  location: { origin: string }
  registration: {
    showNotification: (title: string, options: Record<string, unknown>) => Promise<void>
  }
  skipWaiting: () => Promise<void>
}

declare const self: WorkerScope

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

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  event.waitUntil(landOn(self.clients, self.location.origin, event.notification.data?.path))
})
