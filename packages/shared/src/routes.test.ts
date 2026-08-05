import { describe, expect, it } from 'vitest'

import type { ApiRoute, RouteKey } from './routes.ts'

import { apiRoutes } from './routes.ts'

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
    // The whole point of the manifest. Each endpoint used to exist twice — a literal in
    // `client.ts` and another in a route file — with nothing tying them together, so a
    // rename could land on one and not the other and nothing would fail until runtime.
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
    // The chore this removes: `encodeURIComponent` was written out at 61 call sites,
    // which is 61 chances to leave one off. A slash in an id would otherwise invent a
    // path segment and route somewhere else entirely.
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
