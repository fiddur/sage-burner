import { apiRoutes } from '@sage-burner/shared'
import { describe, expect, it } from 'vitest'

import {
  API_CACHE,
  ASSET_LIMIT,
  CACHED_AT,
  cachedAt,
  cacheFor,
  planFor,
  SHELL_CACHE,
  stamped,
  trim,
  worthStoring,
} from './cache.ts'

const ORIGIN = 'https://burn.example'

const asked = (path: string, extra: { method?: string; mode?: string; origin?: string } = {}) =>
  planFor(
    {
      method: extra.method ?? 'GET',
      mode: extra.mode,
      url: `${extra.origin ?? ORIGIN}${path}`,
    },
    ORIGIN,
  )

describe('what the worker does with a request', () => {
  it('serves a page load from the shell', () => {
    expect(asked('/members', { mode: 'navigate' })).toBe('navigate')
    expect(asked('/', { mode: 'navigate' })).toBe('navigate')
  })

  it('caches the API reads a member looks at', () => {
    expect(asked(apiRoutes.getMembers.path('burn-1'))).toBe('api')
    expect(asked(apiRoutes.getSessions.path('burn-1'))).toBe('api')
    expect(cacheFor('api')).toBe(API_CACHE)
  })

  it('never caches a write', () => {
    expect(asked(apiRoutes.getMembers.path('burn-1'), { method: 'POST' })).toBe('skip')
    expect(asked(apiRoutes.joinEvent.path('burn-1'), { method: 'PUT' })).toBe('skip')
    expect(asked(apiRoutes.leaveEvent.path('burn-1'), { method: 'DELETE' })).toBe('skip')
  })

  it('never caches the redeploy check', () => {
    expect(asked(apiRoutes.getVersion.path())).toBe('skip')
  })

  it('never caches a whole conversation, which would be a key per dream', () => {
    expect(asked(apiRoutes.getThread.path('thread-1'))).toBe('skip')
    expect(asked(apiRoutes.getThread.path('thread-2'))).toBe('skip')
    expect(asked(apiRoutes.getFeed.path())).toBe('api')
  })

  it('never caches what a reset link is worth, the URL being the token itself', () => {
    expect(asked(apiRoutes.getPasswordResetState.path('a-token'))).toBe('skip')
  })

  it('does cache somebody’s page, which is one key per member and not per thing', () => {
    expect(asked(apiRoutes.accountProfile.path('a-1'))).toBe('api')
    expect(cacheFor(asked(apiRoutes.accountProfile.path('a-1')))).toBe(API_CACHE)
  })

  it('never caches a stored picture, for the same reason and more bytes', () => {
    expect(asked(apiRoutes.storedImage.path('img-1'))).toBe('skip')
    expect(asked(apiRoutes.storedImage.path('img-2'))).toBe('skip')
    expect(asked(apiRoutes.accountAvatar.path('a-1'))).toBe('api')
  })

  it('keeps the app itself apart from the data', () => {
    expect(cacheFor(asked('/assets/index-abc123.js'))).toBe(SHELL_CACHE)
    expect(cacheFor(asked(apiRoutes.webManifest.path()))).toBe(SHELL_CACHE)
    expect(cacheFor(asked(apiRoutes.getInstallationIcon.path()))).toBe(SHELL_CACHE)
    expect(cacheFor(asked(apiRoutes.getTouchIcon.path('180')))).toBe(SHELL_CACHE)
    expect(cacheFor(asked(apiRoutes.getInstallationBanner.path()))).toBe(SHELL_CACHE)
    expect(cacheFor(asked(apiRoutes.getChangelog.path()))).toBe(SHELL_CACHE)
    expect(cacheFor(asked(apiRoutes.getPrivacy.path()))).toBe(SHELL_CACHE)
    expect(cacheFor(asked(apiRoutes.getTerms.path()))).toBe(SHELL_CACHE)
    expect(cacheFor(asked(apiRoutes.getMyProfile.path()))).toBe(API_CACHE)
  })

  it('leaves another origin alone', () => {
    expect(asked('/api/events', { origin: 'https://elsewhere.example' })).toBe('skip')
    expect(asked('/assets/index-abc123.js', { origin: 'https://elsewhere.example' })).toBe('skip')
  })

  it('has nowhere to put the requests it skips', () => {
    expect(cacheFor('skip')).toBeUndefined()
  })
})

const answered = (contentType: string, init: { status?: number } = {}) =>
  new Response('body', { status: init.status ?? 200, headers: { 'content-type': contentType } })

describe('what is worth keeping', () => {
  it('refuses a navigation that did not answer with the app', () => {
    expect(worthStoring('navigate', answered('text/calendar; charset=utf-8'))).toBe(false)
    expect(worthStoring('navigate', answered('application/json'))).toBe(false)
    expect(worthStoring('navigate', answered('image/svg+xml'))).toBe(false)
  })

  it('keeps a navigation that did', () => {
    expect(worthStoring('navigate', answered('text/html; charset=utf-8'))).toBe(true)
  })

  it('does not ask what type the others are', () => {
    expect(worthStoring('asset', answered('text/css'))).toBe(true)
    expect(worthStoring('api', answered('application/json'))).toBe(true)
    expect(worthStoring('app', answered('application/manifest+json'))).toBe(true)
  })

  it('never keeps a failure, whatever it is about', () => {
    expect(worthStoring('navigate', answered('text/html', { status: 503 }))).toBe(false)
    expect(worthStoring('api', answered('application/json', { status: 404 }))).toBe(false)
    expect(worthStoring('asset', answered('text/css', { status: 500 }))).toBe(false)
  })

  it('has nowhere to put a skipped request', () => {
    expect(worthStoring('skip', answered('text/html'))).toBe(false)
  })
})

describe('the stamp saying when an answer was true', () => {
  it('survives on the way back out of the cache', async () => {
    const response = new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } })

    const kept = await stamped(response, '2026-08-06T12:00:00.000Z')

    expect(cachedAt(kept)).toBe('2026-08-06T12:00:00.000Z')
    expect(kept.headers.get('content-type')).toBe('application/json')
    expect(await kept.text()).toBe('{"ok":true}')
  })

  it('is absent on an answer that came straight off the network', () => {
    expect(cachedAt(new Response('{}'))).toBeUndefined()
  })

  it('leaves the original readable', async () => {
    const response = new Response('{"ok":true}')

    await stamped(response, '2026-08-06T12:00:00.000Z')

    expect(await response.text()).toBe('{"ok":true}')
  })

  it('names a header the page reads by the same constant', () => {
    expect(CACHED_AT).toBe('x-cached-at')
  })
})

const fakeCache = (urls: string[]) => {
  const keys = urls.map((url) => new Request(`${ORIGIN}${url}`))

  return {
    kept: () =>
      keys.map((request) => {
        const { pathname, search } = new URL(request.url)
        return `${pathname}${search}`
      }),
    keys: () => Promise.resolve([...keys]),
    delete: (request: Request) => {
      const at = keys.findIndex((held) => held.url === request.url)
      if (at >= 0) keys.splice(at, 1)
      return Promise.resolve(at >= 0)
    },
  }
}

describe('keeping the asset cache from growing forever', () => {
  it('drops the oldest builds first', async () => {
    const cache = fakeCache(['/assets/old.js', '/assets/mid.js', '/assets/new.js'])

    expect(await trim(cache, 2)).toBe(1)
    expect(cache.kept()).toEqual(['/assets/mid.js', '/assets/new.js'])
  })

  it('never counts or evicts the shell, the manifest, the icon or the banner', async () => {
    const cache = fakeCache([
      '/index.html',
      '/manifest.webmanifest',
      '/api/installation/icon',
      '/api/installation/banner',
      '/assets/old.js',
      '/assets/new.js',
    ])

    expect(await trim(cache, 1)).toBe(1)
    expect(cache.kept()).toEqual([
      '/index.html',
      '/manifest.webmanifest',
      '/api/installation/icon',
      '/api/installation/banner',
      '/assets/new.js',
    ])
  })

  it('keeps only the newest of a picture that carries its version in the URL', async () => {
    const cache = fakeCache([
      '/api/installation/banner?v=1',
      '/api/installation/icon?v=1',
      '/api/installation/banner?v=2',
      '/api/installation/banner?v=3',
    ])

    expect(await trim(cache, ASSET_LIMIT)).toBe(2)
    expect(cache.kept()).toEqual(['/api/installation/icon?v=1', '/api/installation/banner?v=3'])
  })

  it('keeps both spellings of the icon, which are two live entries rather than two versions', async () => {
    const cache = fakeCache([
      '/api/installation/icon',
      '/api/installation/icon?v=2',
      '/api/installation/banner?v=1',
      '/api/installation/banner?v=2',
    ])

    expect(await trim(cache, ASSET_LIMIT)).toBe(1)
    expect(cache.kept()).toEqual([
      '/api/installation/icon',
      '/api/installation/icon?v=2',
      '/api/installation/banner?v=2',
    ])
  })

  it('keeps the unfiltered feed and the newest filtered one, and no key per chip combination', async () => {
    const cache = fakeCache([
      '/api/feed',
      '/api/feed?kinds=session',
      '/api/feed?kinds=song',
      '/api/feed?kinds=attendance,post',
    ])

    expect(await trim(cache, ASSET_LIMIT)).toBe(2)
    expect(cache.kept()).toEqual(['/api/feed', '/api/feed?kinds=attendance,post'])
  })

  it('leaves the shell alone however many times it has been stored', async () => {
    const cache = fakeCache(['/index.html', '/manifest.webmanifest', '/assets/one.js'])

    expect(await trim(cache, ASSET_LIMIT)).toBe(0)
    expect(cache.kept()).toEqual(['/index.html', '/manifest.webmanifest', '/assets/one.js'])
  })

  it('leaves a cache under the limit alone', async () => {
    const cache = fakeCache(['/assets/one.js', '/assets/two.js'])

    expect(await trim(cache, ASSET_LIMIT)).toBe(0)
    expect(cache.kept()).toEqual(['/assets/one.js', '/assets/two.js'])
  })

  it('holds several builds at the limit it ships with', () => {
    expect(ASSET_LIMIT).toBeGreaterThanOrEqual(20)
  })
})
