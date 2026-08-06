import { API_CACHE } from './sw/cache.ts'

/**
 * The page's side of the service worker (#256).
 *
 * The worker itself does the caching; this is registering it and, on the way out,
 * throwing away what it kept.
 */

/**
 * Where the built worker lands, and the only place it can: a worker's scope is the
 * directory it is served from, so anything deeper than the root could not control
 * `/members`.
 */
export const SERVICE_WORKER_URL = '/sw.js'

/**
 * Enough of the browser for each half, so a test can supply one.
 *
 * Narrower than the real objects, in the same spirit as `push.ts`'s `PushBrowser`:
 * the registration this returns is never looked at, and saying so keeps a test from
 * having to build a `ServiceWorkerRegistration` it does not use.
 */
export interface WorkerRegistrar {
  register: (url: string) => Promise<unknown>
}

export interface CacheDropper {
  delete: (name: string) => Promise<boolean>
}

/**
 * Register on every load, not only when push is turned on.
 *
 * `push.ts` registers the same URL when somebody enables notifications, which is a
 * no-op once this has run — a registration is keyed on its URL. It stayed the only
 * caller while the worker only handled push; offline has to be there for everybody.
 *
 * Failure is swallowed on purpose. Registration throws in an insecure context and on
 * a browser with workers disabled, and neither is worth a message: the app works, it
 * just will not work offline.
 */
export const registerServiceWorker = (
  container: WorkerRegistrar | undefined = globalThis.navigator?.serviceWorker,
): void => {
  if (container === undefined) return

  void container.register(SERVICE_WORKER_URL).catch(() => undefined)
}

/**
 * Delete the member data the worker stored, on the way out of the app.
 *
 * The whole cache rather than entries chosen from it: what was cached is every API
 * answer this person saw, and picking through it by URL would be a list to keep in
 * step with the routes. The shell and the bundles stay — they are nobody's data, and
 * dropping them would mean the next person to open the app offline gets nothing.
 *
 * Best-effort by design. A browser with no Cache Storage never stored anything to
 * begin with, and a sign-out must not fail because a cache would not open.
 */
export const forgetCachedMemberData = async (
  storage: CacheDropper | undefined = globalThis.caches,
): Promise<boolean> => {
  if (storage === undefined) return false

  try {
    return await storage.delete(API_CACHE)
  } catch {
    return false
  }
}
