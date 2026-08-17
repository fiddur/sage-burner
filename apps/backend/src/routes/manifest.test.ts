import type { FastifyInstance } from 'fastify'

import { apiRoutes } from '@sage-burner/shared'
import { afterEach, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'

let handle: DbHandle | undefined
let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  handle?.close()
  app = undefined
  handle = undefined
})

const shape = (path: string) => path.replaceAll(/:[^/]+/g, ':*')

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
  const live = await registered()
  const known = new Set(declared().map(({ pair }) => pair))

  expect([...live].filter((pair) => !known.has(pair))).toEqual([])
})
