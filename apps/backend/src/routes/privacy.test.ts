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
    // The requirement rather than a nicety — `privacyResponseSchema` carries why.
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
    // The one case that covers the default, as `app.test.ts` does for the changelog: a path
    // resolved four levels up is exactly the kind that breaks between a checkout and the
    // image, and nothing else here would notice.
    const held = readPrivacy()

    expect(held).not.toBe('')
    expect(held).toContain('members')
  })

  it('falls back to empty for a file that is not there', async () => {
    // What an image built without `PRIVACY.md` gets. The route's own empty case injects the
    // string, so this is the only thing exercising the read itself.
    expect(readPrivacy('/nope')).toBe('')
  })

  it('promises no deletion the app cannot perform', async () => {
    // The invariant: no route deletes an account, and `db.integration.test.ts` asserts that
    // SQLite refuses the delete for anybody who has ever said they were coming. A policy is
    // the one document where a sentence that reads well and is false is a false statement
    // about somebody's data. #35 is the gap.
    const held = readPrivacy()

    expect(held).toMatch(/not something this app can do yet/i)
    expect(held).not.toMatch(/deletes everything attached to it/i)
  })

  it('says the calendar feed is readable without signing in', async () => {
    // `/events/:eventId/schedule.ics` is unauthenticated, and it carries session titles and
    // descriptions that members write. "Visible to the other members — not to anybody
    // outside" read as a promise the feed does not keep.
    const held = readPrivacy()

    expect(held).toMatch(/calendar/i)
    expect(held).toMatch(/anybody holding it can read the programme/i)
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
