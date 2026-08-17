import { describe, expect, it } from 'vitest'

import type { ApiRoute, RouteKey } from './routes.ts'

import { apiRoutes, bannerSrc, feedPath, iconSrc } from './routes.ts'

const keys = Object.keys(apiRoutes) as RouteKey[]

const declared = (fastify: string) => fastify.split('/').filter((part) => part.startsWith(':'))

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
    const seen = new Set<string>()

    for (const key of keys) {
      const route = apiRoutes[key]
      const pair = `${route.method} ${route.fastify}`

      expect(seen.has(pair), pair).toBe(false)
      seen.add(pair)
    }
  })
})

describe('the feed read, which carries what the chip row is showing', () => {
  it('asks for nothing when nothing is filtered, so the plain read is the plain URL', () => {
    expect(feedPath()).toBe('/api/feed')
    expect(feedPath([])).toBe('/api/feed')
  })

  it('names the kinds asked for', () => {
    expect(feedPath(['session', 'song'])).toBe('/api/feed?kinds=session,song')
  })
})

describe('the installation pictures, which several callers have to spell alike', () => {
  it('builds one URL for the icon, encoded, whoever is asking', () => {
    expect(iconSrc('2026-08-01T00:00:00.000Z')).toBe('/api/installation/icon?v=2026-08-01T00%3A00%3A00.000Z')
  })

  it('says default for an installation nobody has uploaded an icon to', () => {
    expect(iconSrc(null)).toBe('/api/installation/icon?v=default')
    expect(iconSrc(undefined)).toBe('/api/installation/icon?v=default')
  })

  it('has no such word for the banner, which is there or is not', () => {
    expect(bannerSrc('2026-08-01T00:00:00.000Z')).toBe(
      '/api/installation/banner?v=2026-08-01T00%3A00%3A00.000Z',
    )
  })
})
