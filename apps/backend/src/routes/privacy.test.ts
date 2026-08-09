import type { FastifyInstance } from 'fastify'

import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { readPrivacy } from './privacy.ts'

let handle: DbHandle | undefined
let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  handle?.close()
  app = undefined
  handle = undefined
})

const build = async (privacy?: string) => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: 's'.repeat(40) }),
    ...(privacy === undefined ? {} : { privacy }),
  })
  return app
}

const fetchPrivacy = (server: FastifyInstance) => server.inject({ method: 'GET', url: '/api/privacy' })

describe('the privacy policy', () => {
  it('is readable by somebody who is not signed in', async () => {
    // The requirement, not a nicety: Facebook's app review opens it as a stranger, and a
    // policy behind a login is not one. So does anybody deciding whether to apply.
    const server = await build('# What we keep\n\nNot much.')

    const got = await fetchPrivacy(server)

    expect(got.statusCode).toBe(200)
    expect(got.json().markdown).toContain('Not much.')
  })

  it('answers a page rather than a 404 for an image built without the file', async () => {
    const server = await build('')

    const got = await fetchPrivacy(server)

    expect(got.statusCode).toBe(200)
    expect(got.json().markdown).toBe('')
  })

  it('may be cached but is revalidated, so an update is not read past', async () => {
    const server = await build('anything')

    expect((await fetchPrivacy(server)).headers['cache-control']).toBe('no-cache')
  })

  it('reads the repository’s own file by default', async () => {
    // The one case that covers the default, as `changelog.test.ts` does for its file: a path
    // resolved four levels up is exactly the kind that breaks between a checkout and the
    // image, and nothing else here would notice.
    const held = readPrivacy()

    expect(held).not.toBe('')
    expect(held).toContain('members')
  })

  it('says the things app review is checking the page against', async () => {
    // Not a style assertion. A reviewer looks for what is collected, who sees it, and how to
    // get rid of it; and the provider paragraph is the one they read most closely, since it
    // is what their own login gives us.
    const held = readPrivacy()

    expect(held).toMatch(/email/i)
    expect(held).toMatch(/Discord or Facebook/i)
    expect(held).toMatch(/profile picture/i)
    expect(held).toMatch(/remove|delete/i)
    expect(held).toMatch(/never shown to anybody/i)
  })
})
