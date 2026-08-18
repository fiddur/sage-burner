import { apiRoutes } from '@sage-burner/shared'

export const SHELL_CACHE = 'sage-burner-shell-v1'

export const API_CACHE = 'sage-burner-api-v1'

export const SHELL_KEY = '/index.html'

export const ASSET_LIMIT = 40

export const CACHED_AT = 'x-cached-at'

export type CachePlan = 'api' | 'app' | 'asset' | 'navigate' | 'skip'

const NEVER_CACHED: readonly string[] = [apiRoutes.getVersion.path()]

const prefixOf = (fastify: string): string => `${fastify.split('/:')[0] ?? fastify}/`

const NEVER_CACHED_PREFIXES: readonly string[] = [
  prefixOf(apiRoutes.getThread.fastify),
  prefixOf(apiRoutes.storedImage.fastify),
  prefixOf(apiRoutes.getPasswordResetState.fastify),
]

export const planFor = (
  request: { method: string; mode?: string; url: string },
  origin: string,
): CachePlan => {
  if (request.method !== 'GET') return 'skip'

  if (request.mode === 'navigate') return 'navigate'

  const { pathname, origin: asked } = new URL(request.url)
  if (asked !== origin) return 'skip'

  if (pathname.startsWith('/assets/')) return 'asset'
  if (pathname === apiRoutes.webManifest.path()) return 'app'
  if (pathname === apiRoutes.getInstallationIcon.path()) return 'app'
  if (pathname.startsWith(prefixOf(apiRoutes.getTouchIcon.fastify))) return 'app'
  if (pathname === apiRoutes.getInstallationBanner.path()) return 'app'
  if (pathname === apiRoutes.getChangelog.path()) return 'app'
  if (pathname === apiRoutes.getPrivacy.path()) return 'app'
  if (pathname === apiRoutes.getTerms.path()) return 'app'
  if (NEVER_CACHED.includes(pathname)) return 'skip'
  if (NEVER_CACHED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return 'skip'
  if (pathname.startsWith('/api/')) return 'api'

  return 'skip'
}

export const cacheFor = (plan: CachePlan): string | undefined => {
  if (plan === 'api') return API_CACHE
  if (plan === 'app' || plan === 'asset' || plan === 'navigate') return SHELL_CACHE
  return undefined
}

export const worthStoring = (plan: CachePlan, response: Pick<Response, 'headers' | 'ok'>): boolean => {
  if (!response.ok) return false
  if (cacheFor(plan) === undefined) return false
  if (plan !== 'navigate') return true

  return (response.headers.get('content-type') ?? '').includes('text/html')
}

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

// A count-based trim over the lot is the one thing this must not be: it could evict the shell,
// which is what makes the app open offline at all.
export const trim = async (cache: Pick<Cache, 'delete' | 'keys'>, limit: number): Promise<number> => {
  const held = (await cache.keys()).map((request) => {
    const { pathname, search } = new URL(request.url)

    return { request, pathname, search }
  })
  const assets = held.filter((entry) => entry.pathname.startsWith('/assets/'))
  const versioned = held.filter((entry) => !entry.pathname.startsWith('/assets/') && entry.search !== '')

  const newest = new Map(versioned.map((entry) => [entry.pathname, entry.request.url]))
  const doomed = [
    ...versioned.filter((entry) => newest.get(entry.pathname) !== entry.request.url),
    ...assets.slice(0, Math.max(0, assets.length - limit)),
  ].map((entry) => entry.request)

  for (const request of doomed) await cache.delete(request)

  return doomed.length
}

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
