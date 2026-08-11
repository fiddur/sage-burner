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
    // Every plan begins with the method, so a POST to a path that reads well is
    // still nothing to store.
    expect(asked(apiRoutes.getMembers.path('burn-1'), { method: 'POST' })).toBe('skip')
    expect(asked(apiRoutes.joinEvent.path('burn-1'), { method: 'PUT' })).toBe('skip')
    expect(asked(apiRoutes.leaveEvent.path('burn-1'), { method: 'DELETE' })).toBe('skip')
  })

  it('never caches the redeploy check', () => {
    // A cached answer here would say "the build you already have" for as long as the
    // entry lived, which is the one reply that makes the check pointless.
    expect(asked(apiRoutes.getVersion.path())).toBe('skip')
  })

  it('never caches a whole conversation, which would be a key per dream', () => {
    // Every other read here is one key for a page, replaced in place. A thread is one
    // per dream ever opened, kept until sign-out — what #311 fixed for the banner. The
    // feed's card carries the newest few lines, so offline is not left with nothing.
    expect(asked(apiRoutes.getThread.path('thread-1'))).toBe('skip')
    expect(asked(apiRoutes.getThread.path('thread-2'))).toBe('skip')
    // The passing sibling: the feed itself is a page, so it is kept.
    expect(asked(apiRoutes.getFeed.path())).toBe('api')
  })

  it('does cache somebody’s page, which is one key per member and not per thing', () => {
    // The growth argument that excludes a thread and a picture does not reach this: there
    // are as many of these as there are accounts — a few dozen — and each is a few hundred
    // bytes, so the cache does not grow with use the way a key per dream ever opened does.
    // Being able to look up how to reach somebody with no signal is most of the point.
    expect(asked(apiRoutes.accountProfile.path('a-1'))).toBe('api')
    expect(cacheFor(asked(apiRoutes.accountProfile.path('a-1')))).toBe(API_CACHE)
  })

  it('never caches a stored picture, for the same reason and more bytes', () => {
    // One key per photograph anybody has scrolled past, kept until sign-out, where the
    // entries this cache is for are kilobytes of JSON replaced in place (#379). The
    // route answers `immutable`, so the browser's own cache still holds them.
    expect(asked(apiRoutes.storedImage.path('img-1'))).toBe('skip')
    expect(asked(apiRoutes.storedImage.path('img-2'))).toBe('skip')
    // The passing sibling: a face is one key per member and is kept.
    expect(asked(apiRoutes.accountAvatar.path('a-1'))).toBe('api')
  })

  it('keeps the app itself apart from the data', () => {
    // The shell cache survives a sign-out and the API cache does not, so which one a
    // thing lands in is the whole of what stays on a device afterwards.
    expect(cacheFor(asked('/assets/index-abc123.js'))).toBe(SHELL_CACHE)
    expect(cacheFor(asked(apiRoutes.webManifest.path()))).toBe(SHELL_CACHE)
    expect(cacheFor(asked(apiRoutes.getInstallationIcon.path()))).toBe(SHELL_CACHE)
    expect(cacheFor(asked(apiRoutes.getTouchIcon.path('180')))).toBe(SHELL_CACHE)
    // The banner is the installation's own picture on a public page, so it belongs
    // with the icon rather than with the reads it shares a prefix with.
    expect(cacheFor(asked(apiRoutes.getInstallationBanner.path()))).toBe(SHELL_CACHE)
    // And the changelog and the policy, on the same argument: neither is anybody's data
    // (#325, #402), so neither is a sign-out's to take away.
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
    // The ICS feed is a plain link in the page, so clicking it is a `navigate` fetch
    // that answers `text/calendar`. Stored under the shell's key, it would make every
    // offline open of the app render a calendar file until some later online
    // navigation overwrote it.
    expect(worthStoring('navigate', answered('text/calendar; charset=utf-8'))).toBe(false)
    expect(worthStoring('navigate', answered('application/json'))).toBe(false)
    expect(worthStoring('navigate', answered('image/svg+xml'))).toBe(false)
  })

  it('keeps a navigation that did', () => {
    // The passing sibling: refusing every navigation would satisfy the test above
    // while leaving the app with no offline shell at all, which is the feature.
    expect(worthStoring('navigate', answered('text/html; charset=utf-8'))).toBe(true)
  })

  it('does not ask what type the others are', () => {
    // An asset is whatever Vite emitted and an API read is JSON; only a navigation
    // can be answered by something that is not what was asked for.
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
    // `stamped` has to clone rather than consume: the same response is handed to the
    // page while the copy goes to the cache, and a body can only be read once.
    const response = new Response('{"ok":true}')

    await stamped(response, '2026-08-06T12:00:00.000Z')

    expect(await response.text()).toBe('{"ok":true}')
  })

  it('names a header the page reads by the same constant', () => {
    expect(CACHED_AT).toBe('x-cached-at')
  })
})

/** Enough of `Cache` to exercise the trim, in insertion order like the real one. */
const fakeCache = (urls: string[]) => {
  const keys = urls.map((url) => new Request(`${ORIGIN}${url}`))

  return {
    // With the query, since that is the whole of what tells two banners apart. Entries
    // without one read exactly as their pathname.
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
    // They share the cache with the assets, and the shell is what makes the app open
    // offline at all — a count-based trim over the lot could take it (#268).
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
    // The leak #310 left behind: the homepage quotes the banner as `?v=<updated_at>`,
    // so every upload is a *new* key — and `trim` skipping everything outside
    // `/assets/` meant nothing ever evicted the old one. About a megabyte per upload,
    // kept forever. The icon is versioned the same way.
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
    // `/api/installation/icon` is asked for bare by the header's brand mark and by the
    // favicon, and with `?v=` by the settings page and the manifest. Both are live, and
    // a one-per-path rule that did not look at the query would drop whichever was
    // stored first — offline, the header's mark then draws as a broken image.
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
    // The chip row puts its lit-set in the query (#472), so an afternoon of tapping would
    // otherwise leave a key per combination. The one-per-path rule already covers it, and
    // the unfiltered read carries no query so it survives beside the newest filtered one.
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
    // One entry per pathname is what makes the rule above safe: the shell has exactly
    // one, so no number of re-puts can bring it near an eviction.
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
    // The number matters: too tight and it evicts a chunk the current page is about
    // to ask for, which offline means a blank screen rather than a slow one.
    expect(ASSET_LIMIT).toBeGreaterThanOrEqual(20)
  })
})
