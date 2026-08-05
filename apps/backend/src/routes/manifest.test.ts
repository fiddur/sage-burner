import type { FastifyInstance } from 'fastify'

import { apiRoutes } from '@sage-burner/shared'
import { afterEach, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'

/**
 * The manifest and the routing table say the same thing, checked against Fastify
 * rather than against the source.
 *
 * Structural rather than disciplinary, which is the whole reason it reads the table
 * back out of Fastify instead of scanning the route files. A check that inspects the
 * source has to model how a registration is written — and can therefore share a blind
 * spot with the thing it is checking. This one does not care how the path got there.
 */

let handle: DbHandle | undefined
let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  handle?.close()
  app = undefined
  handle = undefined
})

/**
 * Route shape, with every parameter's name replaced.
 *
 * Fastify matches parameters positionally, so `:eventId` and `:id` in the same segment
 * are the same route to it — and it prints them merged, as `:id|:eventId`, when two
 * routes share a prefix and name that segment differently. Comparing shapes is
 * therefore comparing the thing routing actually decides on. The names still matter to
 * the handler reading `request.params`, and nothing here covers that — the route's
 * `<{ Params: … }>` generic is an assertion about the path string, not a check against
 * it. What catches a renamed parameter is the route's own tests, which request real
 * paths.
 */
const shape = (path: string) => path.replaceAll(/:[^/]+/g, ':*')

/** Every `METHOD /path` Fastify has, rebuilt from the tree it prints. */
const registered = async (): Promise<Set<string>> => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: 's'.repeat(40) }),
  })
  await app.ready()

  const found = new Set<string>()
  const segments = new Map<number, string>()

  for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
    const match = /^((?:[│ ] {3})*)(?:[├└]── )?(\S*)(?: \((.+)\))?$/.exec(line)
    const [, indent, segment, methods] = match ?? []
    if (indent === undefined || segment === undefined) continue

    const depth = indent.length / 4
    segments.set(depth, segment)
    if (methods === undefined) continue

    const path = Array.from({ length: depth + 1 }, (_, level) => segments.get(level) ?? '').join('')
    for (const method of methods.split(',')) {
      // HEAD is Fastify's own, added beside every GET. Nothing declares it.
      if (method.trim() !== 'HEAD') found.add(`${method.trim()} ${shape(path)}`)
    }
  }

  return found
}

const declared = () =>
  Object.entries(apiRoutes).map(([key, route]) => ({
    key,
    pair: `${route.method} ${shape(route.fastify)}`,
  }))

it('registers every route the manifest declares', async () => {
  const live = await registered()

  expect(declared().filter(({ pair }) => !live.has(pair))).toEqual([])
})

it('registers nothing the manifest does not declare', async () => {
  // The direction that makes the manifest a source rather than a list. Without it a
  // route added straight to a route file would never appear in it, and the client
  // could only reach it by spelling the path a second time — which is the whole of
  // what #152 set out to stop.
  const live = await registered()
  const known = new Set(declared().map(({ pair }) => pair))

  expect([...live].filter((pair) => !known.has(pair))).toEqual([])
})
