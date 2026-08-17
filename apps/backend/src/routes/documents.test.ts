import type { FastifyInstance } from 'fastify'

import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { readDocument } from './documents.ts'

let handle: DbHandle | undefined
let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  handle?.close()
  app = undefined
  handle = undefined
})

const build = async (documents: { privacy?: string; terms?: string } = {}) => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: 's'.repeat(40) }),
    ...documents,
  })
  return app
}

const fetchDocument = (server: FastifyInstance, url: string) => server.inject({ method: 'GET', url })

describe('the served markdown files', () => {
  it('falls back to empty for a file that is not in the image', async () => {
    expect(readDocument('nope.md')).toBe('')
  })
})

describe('the privacy policy', () => {
  it('is readable by somebody who is not signed in', async () => {
    const server = await build({ privacy: '# What we keep\n\nNot much.' })

    const got = await fetchDocument(server, '/api/privacy')

    expect(got.statusCode).toBe(200)
    expect(got.json().markdown).toContain('Not much.')
  })

  it('answers a page rather than a 404 for an image built without the file', async () => {
    const server = await build({ privacy: '' })

    const got = await fetchDocument(server, '/api/privacy')

    expect(got.statusCode).toBe(200)
    expect(got.json().markdown).toBe('')
  })

  it('may be cached but is revalidated, so an update is not read past', async () => {
    const server = await build({ privacy: 'anything' })

    expect((await fetchDocument(server, '/api/privacy')).headers['cache-control']).toBe('no-cache')
  })

  it('reads the repository’s own file by default', async () => {
    const held = readDocument('PRIVACY.md')

    expect(held).not.toBe('')
    expect(held).toContain('members')
  })

  it('promises no deletion the app cannot perform', async () => {
    const held = readDocument('PRIVACY.md')

    expect(held).toMatch(/not something this app can do yet/i)
    expect(held).not.toMatch(/deletes everything attached to it/i)
  })

  it('says the calendar feed is readable without signing in', async () => {
    const held = readDocument('PRIVACY.md')

    expect(held).toMatch(/calendar/i)
    expect(held).toMatch(/anybody\s+holding\s+it\s+can\s+read\s+the\s+programme/i)
  })

  it('says the feed address is the calendar’s own, and can be taken back', async () => {
    const held = readDocument('PRIVACY.md')

    expect(held).toMatch(/unguessable\s+identifier\s+of\s+its\s+own/i)
    expect(held).toMatch(/give\s+the\s+calendar\s+a\s+new\s+address/i)
  })

  it('names the one thing that arrives unasked, and where to stop it', async () => {
    const held = readDocument('PRIVACY.md')

    expect(held).toMatch(/unless\s+you\s+say\s+otherwise/i)
    expect(held).toMatch(/Your\s+details\s+→\s+Notifications/i)
  })

  it('says when you were here is kept, that being the one thing not typed in', async () => {
    const held = readDocument('PRIVACY.md')

    expect(held).toMatch(/When\s+you\s+were\s+last\s+here/i)
  })

  it('says the things app review is checking the page against', async () => {
    const held = readDocument('PRIVACY.md')

    expect(held).toMatch(/email/i)
    expect(held).toMatch(/Discord or Facebook/i)
    expect(held).toMatch(/profile picture/i)
    expect(held).toMatch(/remove|delete/i)
    expect(held).toMatch(/never shown to anybody/i)
  })

  it('does not claim less than the provider’s own consent screen asks for', async () => {
    const held = readDocument('PRIVACY.md')

    expect(held).toMatch(/screen\s+will\s+name\s+more/i)
    expect(held).toMatch(/your\s+banner\s+among\s+it/i)
    expect(held).toMatch(/dropped\s+rather\s+than\s+kept/i)
  })

  it('accounts for the username that screen names, which linking now keeps', async () => {
    const held = readDocument('PRIVACY.md')

    expect(held).toMatch(/Discord\s+name,\s+added\s+to\s+how\s+people\s+can\s+reach\s+you/i)
    expect(held).toMatch(/takes\s+the\s+name\s+it\s+put\s+in\s+your\s+contact\s+list\s+back\s+out/i)
  })

  it('is the deletion instructions Meta’s console is pointed at', async () => {
    const held = readDocument('PRIVACY.md')

    expect(held).toMatch(/Other\s+ways\s+to\s+sign\s+in/i)
    expect(held).toMatch(/Take\s+it\s+off/i)
    expect(held).toMatch(/only\s+way\s+you\s+have\s+left\s+of\s+signing\s+in/i)
  })
})

describe('the terms of service', () => {
  it('is readable by somebody who is not signed in', async () => {
    const server = await build({ terms: '# Using this\n\nBe kind.' })

    const got = await fetchDocument(server, '/api/terms')

    expect(got.statusCode).toBe(200)
    expect(got.json().markdown).toContain('Be kind.')
  })

  it('answers a page rather than a 404 for an image built without the file', async () => {
    const server = await build({ terms: '' })

    const got = await fetchDocument(server, '/api/terms')

    expect(got.statusCode).toBe(200)
    expect(got.json().markdown).toBe('')
  })

  it('may be cached but is revalidated, so an update is not read past', async () => {
    const server = await build({ terms: 'anything' })

    expect((await fetchDocument(server, '/api/terms')).headers['cache-control']).toBe('no-cache')
  })

  it('reads the repository’s own file by default', async () => {
    const held = readDocument('TERMS.md')

    expect(held).not.toBe('')
    expect(held).toMatch(/organis/i)
  })

  it('says who the agreement is actually with', async () => {
    const held = readDocument('TERMS.md')

    expect(held).toMatch(/agreement\s+with\s+them\s+and\s+with\s+nobody\s+else/i)
    expect(held).toMatch(/because\s+there\s+is\s+not\s+one/i)
  })

  it('disclaims the warranty the licence disclaims', async () => {
    const held = readDocument('TERMS.md')

    expect(held).toMatch(/no\s+warranty\s+of\s+any\s+kind/i)
    expect(held).toMatch(/AGPL/)
  })

  it('promises no removal the privacy policy says is not there', async () => {
    const held = readDocument('TERMS.md')

    expect(held).toMatch(/ask\s+an\s+organiser/i)
    expect(readDocument('PRIVACY.md')).toMatch(/not something this app can do yet/i)
  })
})
