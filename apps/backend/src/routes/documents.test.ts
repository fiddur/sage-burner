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
    // Each route's own empty case injects the string, so this is the only thing exercising
    // the read itself.
    expect(readDocument('nope.md')).toBe('')
  })
})

describe('the privacy policy', () => {
  it('is readable by somebody who is not signed in', async () => {
    // The requirement rather than a nicety — `privacyResponseSchema` carries why.
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
    // The one case that covers the default, as `app.test.ts` does for the changelog: a path
    // resolved four levels up is exactly the kind that breaks between a checkout and the
    // image, and nothing else here would notice.
    const held = readDocument('PRIVACY.md')

    expect(held).not.toBe('')
    expect(held).toContain('members')
  })

  it('promises no deletion the app cannot perform', async () => {
    // The invariant: no route deletes an account, and `db.integration.test.ts` asserts that
    // SQLite refuses the delete for anybody who has ever said they were coming. A policy is
    // the one document where a sentence that reads well and is false is a false statement
    // about somebody's data. #35 is the gap.
    const held = readDocument('PRIVACY.md')

    expect(held).toMatch(/not something this app can do yet/i)
    expect(held).not.toMatch(/deletes everything attached to it/i)
  })

  it('says the calendar feed is readable without signing in', async () => {
    // `/calendar/:token/schedule.ics` is unauthenticated, and it carries session titles and
    // descriptions that members write. "Visible to the other members — not to anybody
    // outside" read as a promise the feed does not keep.
    const held = readDocument('PRIVACY.md')

    expect(held).toMatch(/calendar/i)
    expect(held).toMatch(/anybody\s+holding\s+it\s+can\s+read\s+the\s+programme/i)
  })

  it('says the feed address is the calendar’s own, and can be taken back', async () => {
    // It was the burn's id, which `/api/events/active` answers unguarded to every anonymous
    // visit — so "published nowhere" was false for the burn being planned, and the policy
    // said so plainly until #408 gave the feed a token of its own.
    const held = readDocument('PRIVACY.md')

    // `\s+` between every word: the file is wrapped prose, so a reflow puts a newline
    // wherever it likes and a literal space fails against a sentence that is still there.
    expect(held).toMatch(/unguessable\s+identifier\s+of\s+its\s+own/i)
    expect(held).toMatch(/give\s+the\s+calendar\s+a\s+new\s+address/i)
  })

  it('says the things app review is checking the page against', async () => {
    // Not a style assertion. A reviewer looks for what is collected, who sees it, and how to
    // get rid of it; and the provider paragraph is the one they read most closely, since it
    // is what their own login gives us.
    const held = readDocument('PRIVACY.md')

    expect(held).toMatch(/email/i)
    expect(held).toMatch(/Discord or Facebook/i)
    expect(held).toMatch(/profile picture/i)
    expect(held).toMatch(/remove|delete/i)
    expect(held).toMatch(/never shown to anybody/i)
  })

  it('does not claim less than the provider’s own consent screen asks for', async () => {
    // #429. Discord's screen says "your username, avatar and banner", because `identify` is the
    // smallest scope it offers and there is no id-only one. The policy listed an identifier and a
    // picture and then said "nothing else", so a member comparing the two got a smaller number
    // from us with no explanation — on the one page that exists to be trusted about their data.
    const held = readDocument('PRIVACY.md')

    expect(held).toMatch(/screen\s+will\s+name\s+more/i)
    expect(held).toMatch(/username\s+and\s+your\s+banner/i)
    expect(held).toMatch(/dropped\s+rather\s+than\s+kept/i)
  })

  it('is the deletion instructions Meta’s console is pointed at', async () => {
    // This URL goes in Basic Settings as the data deletion instructions, so the steps have to
    // be on the page rather than implied by it (#419). `messageForRemoval` is the 409 the last
    // sentence describes, and `maybeAvatar` is why the picture needs its own.
    const held = readDocument('PRIVACY.md')

    expect(held).toMatch(/Other\s+ways\s+to\s+sign\s+in/i)
    expect(held).toMatch(/Take\s+it\s+off/i)
    expect(held).toMatch(/only\s+way\s+you\s+have\s+left\s+of\s+signing\s+in/i)
  })
})

describe('the terms of service', () => {
  it('is readable by somebody who is not signed in', async () => {
    // The privacy policy's requirement and its reason: a reviewer at Meta opens this one as a
    // stranger too, and it is the second URL Basic Settings asks for.
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
    // The one thing about a self-hosted gathering that is genuinely surprising, and the thing
    // a reader would otherwise assume wrong: there is no company on the other side of this.
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
    // The two documents describe one behaviour, so they are the pair most likely to drift:
    // the app refuses to delete a member who has ever said they were coming, and terms
    // offering a button would contradict a policy that says there is none.
    const held = readDocument('TERMS.md')

    expect(held).toMatch(/ask\s+an\s+organiser/i)
    expect(readDocument('PRIVACY.md')).toMatch(/not something this app can do yet/i)
  })
})
