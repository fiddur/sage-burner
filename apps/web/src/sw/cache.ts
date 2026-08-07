import { apiRoutes } from '@sage-burner/shared'

/**
 * What the service worker does with a request, decided here so it can be tested.
 *
 * The worker itself is a shell around this: `main.ts` wires browser events to these
 * answers and does nothing a test would want to assert. That split is the whole
 * point — the file that used to be `public/sw.js` was kept free of caching precisely
 * because nothing verified it, and this is what pays that argument off rather than
 * ignoring it.
 */

/**
 * The app's own furniture: the shell, the hashed bundles, the manifest, the icon.
 *
 * Kept across a sign-out, unlike `API_CACHE`. None of it is anybody's data, and
 * throwing it away would mean the next person to open the app offline gets nothing
 * at all.
 */
export const SHELL_CACHE = 'sage-burner-shell-v1'

/**
 * Answers from the API — the roster, the schedule, who you are.
 *
 * **This is member data on disk**, which is why signing out deletes the whole cache
 * (#256). A phone handed on or lost after a sign-out holds none of it.
 */
export const API_CACHE = 'sage-burner-api-v1'

/** Where a navigation's HTML is kept, under one key whatever path was asked for. */
export const SHELL_KEY = '/index.html'

/**
 * How many hashed assets to keep.
 *
 * Vite emits a handful per build and their names change with their bytes, so
 * yesterday's are dead weight the moment a deploy lands. `Cache.keys()` is in
 * insertion order, so dropping from the front drops the oldest build first — which
 * is what wanted dropping. Generous enough to hold several builds, so this never
 * evicts something the current page is about to ask for.
 */
export const ASSET_LIMIT = 40

/** When a cached answer was fetched, for the page to work out how stale it is. */
export const CACHED_AT = 'x-cached-at'

export type CachePlan = 'api' | 'app' | 'asset' | 'navigate' | 'skip'

/**
 * Never cached, because a stale answer is worse than no answer.
 *
 * `/api/version` is how the tab notices a redeploy. Serving it from a cache would
 * answer "the build you already have" forever, which is the one reply that makes the
 * check pointless.
 */
const NEVER_CACHED: readonly string[] = [apiRoutes.getVersion.path()]

/**
 * What to do with one request.
 *
 * `origin` is passed rather than read off `location` so this is a function of its
 * arguments — a cross-origin request (a push service, an image someone linked in
 * their welcome text) is not ours to cache or to serve.
 */
export const planFor = (
  request: { method: string; mode?: string; url: string },
  origin: string,
): CachePlan => {
  if (request.method !== 'GET') return 'skip'

  // Before the origin check: a navigation is always ours, and `mode` is the only
  // thing that tells a page load apart from a fetch for the same URL.
  if (request.mode === 'navigate') return 'navigate'

  const { pathname, origin: asked } = new URL(request.url)
  if (asked !== origin) return 'skip'

  if (pathname.startsWith('/assets/')) return 'asset'
  if (pathname === apiRoutes.webManifest.path()) return 'app'
  if (pathname === apiRoutes.getInstallationIcon.path()) return 'app'
  // With the icon rather than with the reads beside it in `/api/`: a banner is the
  // installation's own picture, on a page anybody can see, and the cache that goes at
  // sign-out is the one holding somebody's data.
  if (pathname === apiRoutes.getInstallationBanner.path()) return 'app'
  if (NEVER_CACHED.includes(pathname)) return 'skip'
  if (pathname.startsWith('/api/')) return 'api'

  return 'skip'
}

/** Which cache a plan writes to, or nothing for the plans that do not write. */
export const cacheFor = (plan: CachePlan): string | undefined => {
  if (plan === 'api') return API_CACHE
  if (plan === 'app' || plan === 'asset' || plan === 'navigate') return SHELL_CACHE
  return undefined
}

/**
 * Whether an answer is worth keeping — the one decision, so the worker has none.
 *
 * A failure never is. A 404 or a 500 stored here would be served back for as long as
 * the entry lived, long after the server stopped saying it.
 *
 * **A navigation additionally has to have answered with HTML**, and that is a real
 * bug rather than caution. Not every same-origin navigation returns the app: the ICS
 * feed is a plain `<a href>` in the page, and clicking it is a `mode: 'navigate'`
 * fetch that answers `text/calendar`. Without this the worker would store the
 * calendar under `SHELL_KEY`, and every offline open of the app from then on would
 * render an ICS file instead of the app — until some later online navigation happened
 * to overwrite it. Navigating straight to an `/api/…` URL does the same with JSON.
 *
 * A content type rather than a list of paths to skip: a list is a thing to keep in
 * step with the routes, and the route it goes stale against is the one that breaks
 * the app offline.
 */
export const worthStoring = (plan: CachePlan, response: Pick<Response, 'headers' | 'ok'>): boolean => {
  if (!response.ok) return false
  if (cacheFor(plan) === undefined) return false
  if (plan !== 'navigate') return true

  return (response.headers.get('content-type') ?? '').includes('text/html')
}

/**
 * The same response, carrying when it was stored.
 *
 * A copy rather than a mutation: `Response.headers` is immutable once the response
 * exists, so the header can only be added by building a new one around the same
 * body. The page reads it to tell an answer from the network apart from one from
 * this cache, which is the difference between "live" and "five minutes old".
 */
export const stamped = async (response: Response, at: string): Promise<Response> => {
  const headers = new Headers(response.headers)
  headers.set(CACHED_AT, at)

  return new Response(await response.clone().blob(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export const cachedAt = (response: Pick<Response, 'headers'>): string | undefined =>
  response.headers.get(CACHED_AT) ?? undefined

/**
 * Drop the oldest hashed assets past the limit. See `ASSET_LIMIT` for why the front.
 *
 * Only `/assets/`. The shell cache also holds the shell itself, the manifest, the
 * icon and the banner, and a count-based trim over the lot could evict the one entry
 * that makes the app open offline at all. Re-puts move an entry to the back, so it
 * took forty asset stores with no navigation in between — unlikely rather than
 * impossible, which is not a distinction worth relying on for that entry (#268).
 */
export const trim = async (cache: Pick<Cache, 'delete' | 'keys'>, limit: number): Promise<number> => {
  const keys = (await cache.keys()).filter((request) => new URL(request.url).pathname.startsWith('/assets/'))
  const doomed = keys.slice(0, Math.max(0, keys.length - limit))

  for (const request of doomed) await cache.delete(request)

  return doomed.length
}

/**
 * What somebody sees when they open the app offline having never opened it online.
 *
 * Rare by construction — one successful visit caches the real shell — but the
 * alternative is the browser's own "you are offline" page, which says nothing about
 * this app and offers nothing to do about it. Inline rather than a file, so there is
 * no asset whose own absence is the failure being handled.
 */
export const OFFLINE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offline</title>
<style>body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;
background:#faf7f2;color:#1c1917}main{max-width:24rem;padding:2rem;text-align:center}
@media(prefers-color-scheme:dark){body{background:#1c1917;color:#f5f1eb}}</style></head>
<body><main><h1>No connection</h1>
<p>This page has not been open on this device yet, so there is nothing saved to show.</p>
<p>Try again once you are back online.</p></main></body></html>`
