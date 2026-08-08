import { describe, expect, it } from 'vitest'

import type { ApiRoute, RouteKey } from './routes.ts'

import { apiRoutes, bannerSrc, iconSrc } from './routes.ts'

const keys = Object.keys(apiRoutes) as RouteKey[]

/** How many `:param` segments a Fastify path declares. */
const declared = (fastify: string) => fastify.split('/').filter((part) => part.startsWith(':'))

/**
 * The route a built path corresponds to, by replacing each filled segment with `:name`.
 *
 * Comparing shapes rather than strings, because that is the property worth holding: a
 * path built from the manifest has to route to the registration it was built from.
 */
const shapeOf = (built: string, fastify: string) => {
  const parts = built.split('/')
  const template = fastify.split('/')

  return parts
    .map((part, index) => (template[index]?.startsWith(':') === true ? template[index] : part))
    .join('/')
}

describe('the route manifest', () => {
  it('has a path builder whose output routes to its own registration', () => {
    for (const key of keys) {
      // Widened deliberately: the manifest keeps each builder's own arity, which is
      // what stops `updateEvent.path()` compiling with no id — and which is why a
      // spread needs the shared signature here.
      const route: ApiRoute = apiRoutes[key]
      const params = declared(route.fastify).map((name) => `sample-${name.slice(1)}`)
      const built: string = route.path(...params)

      expect(shapeOf(built, route.fastify), key).toBe(route.fastify)
    }
  })

  it('takes exactly as many parameters as its path declares', () => {
    for (const key of keys) {
      const route = apiRoutes[key]

      expect(route.path.length, key).toBe(declared(route.fastify).length)
    }
  })

  it('encodes every segment it is given', () => {
    // A slash in an id would otherwise invent a path segment and route somewhere else.
    for (const key of keys) {
      const route: ApiRoute = apiRoutes[key]
      const names = declared(route.fastify)
      if (names.length === 0) continue

      const built: string = route.path(...names.map(() => 'a/b'))

      expect(built, key).not.toContain('a/b')
      expect(built, key).toContain('a%2Fb')
    }
  })

  it('declares no (method, path) pair twice', () => {
    // Only the uniqueness half is asserted here. That a method is one of the five is
    // `ApiMethod`'s job, and restating a type as a test is a test that cannot fail.
    const seen = new Set<string>()

    for (const key of keys) {
      const route = apiRoutes[key]
      const pair = `${route.method} ${route.fastify}`

      expect(seen.has(pair), pair).toBe(false)
      seen.add(pair)
    }
  })
})

describe('the installation pictures, which several callers have to spell alike', () => {
  it('builds one URL for the icon, encoded, whoever is asking', () => {
    // Two disagreeing versioned spellings reached `develop` before this existed, and
    // two of those under one path evict each other in the offline cache (#376, #378).
    expect(iconSrc('2026-08-01T00:00:00.000Z')).toBe('/api/installation/icon?v=2026-08-01T00%3A00%3A00.000Z')
  })

  it('says default for an installation nobody has uploaded an icon to', () => {
    // The manifest names an icon unconditionally — the route answers the app's flame.
    expect(iconSrc(null)).toBe('/api/installation/icon?v=default')
  })

  it('has no such word for the banner, which is there or is not', () => {
    expect(bannerSrc('2026-08-01T00:00:00.000Z')).toBe(
      '/api/installation/banner?v=2026-08-01T00%3A00%3A00.000Z',
    )
  })
})
