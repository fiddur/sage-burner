import type { FastifyInstance } from 'fastify'

import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole } from '../db/schema.ts'
import { MAX_AVATAR_BYTES } from './avatars.ts'

const SECRET = 's'.repeat(40)
const NOW = '2026-07-02T00:00:00.000Z'

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
    config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: SECRET }),
    now: () => new Date(NOW),
  })
  return app
}

const db = () => {
  const found = handle?.db
  if (found === undefined) throw new Error('build() first')
  return found
}

const givenAccount = async (roles: ('admin' | 'member')[] = ['member']) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return { id, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
}

/** A tiny but real PNG, so the bytes stored are bytes that mean something. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const upload = (
  server: FastifyInstance,
  cookie: string | undefined,
  body: Buffer,
  contentType = 'image/png',
) =>
  server.inject({
    method: 'PUT',
    url: '/api/me/avatar',
    headers: { ...(cookie === undefined ? {} : { cookie }), 'content-type': contentType },
    payload: body,
  })

const fetchAvatar = (server: FastifyInstance, cookie: string | undefined, accountId: string) =>
  server.inject({
    method: 'GET',
    url: `/api/accounts/${accountId}/avatar`,
    headers: cookie === undefined ? {} : { cookie },
  })

describe('a picture for the circle', () => {
  it('stores what was sent and gives back the same bytes', async () => {
    const server = await build()
    const ada = await givenAccount()

    const stored = await upload(server, ada.cookie, PNG)
    expect(stored.statusCode).toBe(200)
    expect(stored.json().avatar).toBe(NOW)

    const got = await fetchAvatar(server, ada.cookie, ada.id)
    expect(got.statusCode).toBe(200)
    expect(got.headers['content-type']).toBe('image/png')
    expect(got.rawPayload.equals(PNG)).toBe(true)
  })

  it('refuses a type it will not serve back', async () => {
    // The content type is whatever the caller claims and is echoed on the way out,
    // so the list of what can be stored is the list of what can be served.
    const server = await build()
    const ada = await givenAccount()

    expect((await upload(server, ada.cookie, PNG, 'image/svg+xml')).statusCode).toBe(415)
    expect((await upload(server, ada.cookie, PNG, 'text/html')).statusCode).toBe(415)
  })

  it('takes the other two formats a browser can produce', async () => {
    // The passing sibling: a check that refused everything would satisfy the test
    // above while making the feature impossible to use.
    const server = await build()
    const ada = await givenAccount()

    expect((await upload(server, ada.cookie, PNG, 'image/jpeg')).statusCode).toBe(200)
    expect((await upload(server, ada.cookie, PNG, 'image/webp')).statusCode).toBe(200)
  })

  it('refuses one too big to be a resized avatar', async () => {
    const server = await build()
    const ada = await givenAccount()

    const response = await upload(server, ada.cookie, Buffer.alloc(MAX_AVATAR_BYTES + 1, 1))

    expect(response.statusCode).toBe(413)
  })

  it('refuses an empty body', async () => {
    const server = await build()
    const ada = await givenAccount()

    expect((await upload(server, ada.cookie, Buffer.alloc(0))).statusCode).toBe(400)
  })

  it('replaces the old picture rather than keeping both', async () => {
    const server = await build()
    const ada = await givenAccount()
    await upload(server, ada.cookie, PNG)

    const other = Buffer.concat([PNG, Buffer.from([0])])
    await upload(server, ada.cookie, other, 'image/webp')

    const got = await fetchAvatar(server, ada.cookie, ada.id)
    expect(got.headers['content-type']).toBe('image/webp')
    expect(got.rawPayload.equals(other)).toBe(true)
  })

  it('goes back to initials when it is removed', async () => {
    const server = await build()
    const ada = await givenAccount()
    await upload(server, ada.cookie, PNG)

    const removed = await server.inject({
      method: 'DELETE',
      url: '/api/me/avatar',
      headers: { cookie: ada.cookie },
    })

    expect(removed.statusCode).toBe(204)
    expect((await fetchAvatar(server, ada.cookie, ada.id)).statusCode).toBe(404)
  })

  it('is another member’s to see, like the name beside it', async () => {
    const server = await build()
    const ada = await givenAccount()
    const bea = await givenAccount()
    await upload(server, ada.cookie, PNG)

    expect((await fetchAvatar(server, bea.cookie, ada.id)).statusCode).toBe(200)
  })

  it('is nobody’s to see who is not approved', async () => {
    const server = await build()
    const ada = await givenAccount()
    const stranger = await givenAccount([])
    await upload(server, ada.cookie, PNG)

    expect((await fetchAvatar(server, stranger.cookie, ada.id)).statusCode).toBe(403)
    expect((await fetchAvatar(server, undefined, ada.id)).statusCode).toBe(401)
    expect((await upload(server, stranger.cookie, PNG)).statusCode).toBe(403)
  })

  it('will not let a browser decide the bytes are something else', async () => {
    // The type is what the uploader claimed and nothing here decodes the image, so
    // sniffing is the one thing that could turn a stored file into a running one.
    const server = await build()
    const ada = await givenAccount()
    await upload(server, ada.cookie, PNG)

    const got = await fetchAvatar(server, ada.cookie, ada.id)

    expect(got.headers['x-content-type-options']).toBe('nosniff')
  })

  it('may be cached, because the version is in the URL the page asks for', async () => {
    const server = await build()
    const ada = await givenAccount()
    await upload(server, ada.cookie, PNG)

    const got = await fetchAvatar(server, ada.cookie, ada.id)

    expect(got.headers['cache-control']).toContain('private')
    expect(got.headers['cache-control']).toContain('max-age=')
  })

  it('answers 404 for somebody who has none', async () => {
    const server = await build()
    const ada = await givenAccount()
    const bea = await givenAccount()

    expect((await fetchAvatar(server, ada.cookie, bea.id)).statusCode).toBe(404)
  })

  it('rides along with the viewer and the attendee list, so no circle asks for nothing', async () => {
    const server = await build()
    const ada = await givenAccount()

    const before = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: ada.cookie },
    })
    expect(before.json().viewer.avatar).toBeNull()

    await upload(server, ada.cookie, PNG)

    const after = await server.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: ada.cookie } })
    expect(after.json().viewer.avatar).toBe(NOW)
  })

  it('goes with the account when the account goes', async () => {
    const server = await build()
    const ada = await givenAccount()
    await upload(server, ada.cookie, PNG)

    await db().delete(account).where(eq(account.id, ada.id))

    expect(handle?.client.prepare('select count(*) as n from account_avatar').get()?.n).toBe(0)
  })
})
