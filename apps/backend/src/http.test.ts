import type { FastifyInstance } from 'fastify'

import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import type { DbHandle } from './db/index.ts'

import { createApp } from './app.ts'
import { createConfig } from './config.ts'
import { createDb, runMigrations } from './db/index.ts'
import { bodyOf, sendError } from './http.ts'

let handle: DbHandle | undefined
let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  handle?.close()
  app = undefined
  handle = undefined
})

const build = async () => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: 's'.repeat(40) }),
  })

  for (const status of [400, 401, 403, 404, 409, 415, 429] as const) {
    app.get(`/test/${status}`, (_request, reply) => sendError(reply, status))
  }

  await app.ready()
  return app
}

describe('refusing a request', () => {
  it('sends the slug that belongs to each status', async () => {
    const server = await build()

    const answers = await Promise.all(
      [400, 401, 403, 404, 409, 415, 429].map(async (status) => {
        const response = await server.inject({ method: 'GET', url: `/test/${status}` })
        return [status, response.statusCode, response.json().error]
      }),
    )

    expect(answers).toEqual([
      [400, 400, 'bad_request'],
      [401, 401, 'unauthenticated'],
      [403, 403, 'forbidden'],
      [404, 404, 'not_found'],
      [409, 409, 'conflict'],
      [415, 415, 'bad_request'],
      [429, 429, 'rate_limited'],
    ])
  })
})

describe('reading a body', () => {
  const schema = z.object({ name: z.string().min(1) }).strict()

  const parsed = (body: unknown) => bodyOf(schema, { body })

  it('gives back what the schema describes', () => {
    expect(parsed({ name: 'Ada' })).toEqual({ name: 'Ada' })
  })

  it('gives back nothing for a body the schema refuses', () => {
    expect(parsed({ name: '' })).toBeUndefined()
    expect(parsed({ name: 'Ada', extra: true })).toBeUndefined()
    expect(parsed(undefined)).toBeUndefined()
    expect(parsed('a string')).toBeUndefined()
  })

  it('applies the schema defaults, like the safeParse it replaces', () => {
    const withDefault = z.object({ name: z.string(), note: z.string().default('') })

    expect(bodyOf(withDefault, { body: { name: 'Ada' } })).toEqual({
      name: 'Ada',
      note: '',
    })
  })
})
