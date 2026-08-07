import type { FastifyInstance } from 'fastify'

import { MAX_BANNER_BYTES } from '@sage-burner/shared'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { INSTALLATION_ID, account, accountRole } from '../db/schema.ts'

const SECRET = 'b'.repeat(40)
const NOW = '2026-08-07T10:00:00.000Z'

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

const client = () => {
  const found = handle?.client
  if (found === undefined) throw new Error('build() first')
  return found
}

const givenAccount = async (roles: ('admin' | 'member')[] = ['admin']) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return `${SESSION_COOKIE}=${sessions.issue(id)}`
}

/** A tiny but real JPEG, so the bytes stored are bytes that mean something. */
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkI' +
    'CQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==',
  'base64',
)

const put = (server: FastifyInstance, cookie: string | undefined, body: Buffer, contentType = 'image/jpeg') =>
  server.inject({
    method: 'PUT',
    url: '/api/admin/installation/banner',
    headers: { ...(cookie === undefined ? {} : { cookie }), 'content-type': contentType },
    payload: body,
  })

const get = (server: FastifyInstance) => server.inject({ method: 'GET', url: '/api/installation/banner' })

const remove = (server: FastifyInstance, cookie?: string) =>
  server.inject({
    method: 'DELETE',
    url: '/api/admin/installation/banner',
    ...(cookie === undefined ? {} : { headers: { cookie } }),
  })

const installation = (server: FastifyInstance) => server.inject({ method: 'GET', url: '/api/installation' })

describe('the banner', () => {
  it('is 404 until somebody uploads one', async () => {
    // Unlike the icon, which always answers: the manifest names that one
    // unconditionally, and nothing asks for this until `/api/installation` says
    // there is one.
    const server = await build()

    expect((await get(server)).statusCode).toBe(404)
    expect((await installation(server)).json().installation.banner_updated_at).toBeNull()
  })

  it('is served back to anybody, since a crawler carries no cookie', async () => {
    const server = await build()
    const cookie = await givenAccount()

    expect((await put(server, cookie, JPEG)).statusCode).toBe(200)

    const response = await get(server)

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('image/jpeg')
    expect(response.rawPayload.equals(JPEG)).toBe(true)
  })

  it('says when it changed, which is the ?v= a new banner is a new URL by', async () => {
    const server = await build()
    const cookie = await givenAccount()

    expect((await put(server, cookie, JPEG)).json()).toEqual({ banner: NOW })
    expect((await installation(server)).json().installation.banner_updated_at).toBe(NOW)
  })

  it('is served with the headers an uploaded file needs', async () => {
    const server = await build()
    await put(server, await givenAccount(), JPEG)

    const response = await get(server)

    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['content-security-policy']).toBe("default-src 'none'; sandbox")
    expect(response.headers['cache-control']).toBe('no-cache')
  })

  it('replaces the previous one rather than collecting them', async () => {
    const server = await build()
    const cookie = await givenAccount()
    const other = Buffer.concat([JPEG, Buffer.from([0])])

    await put(server, cookie, JPEG)
    await put(server, cookie, other)

    expect((await get(server)).rawPayload.equals(other)).toBe(true)
  })

  it('is removable, and the homepage stops being told about one', async () => {
    const server = await build()
    const cookie = await givenAccount()
    await put(server, cookie, JPEG)

    expect((await remove(server, cookie)).statusCode).toBe(204)
    expect((await get(server)).statusCode).toBe(404)
    expect((await installation(server)).json().installation.banner_updated_at).toBeNull()
  })

  it('takes a JPEG and nothing else', async () => {
    // A crawler draws no SVG, so accepting one would store a banner that looks right
    // on the homepage and leaves the card blank — the very bug this fixes.
    const server = await build()
    const cookie = await givenAccount()

    expect((await put(server, cookie, JPEG, 'image/svg+xml')).statusCode).toBe(415)
    expect((await put(server, cookie, JPEG, 'image/png')).statusCode).toBe(415)
    expect((await put(server, cookie, JPEG)).statusCode).toBe(200)
  })

  it('refuses an empty body, which is not an image', async () => {
    const server = await build()

    expect((await put(server, await givenAccount(), Buffer.alloc(0))).statusCode).toBe(400)
  })

  it('refuses more bytes than a resized banner can be', async () => {
    const server = await build()

    const response = await put(server, await givenAccount(), Buffer.alloc(MAX_BANNER_BYTES + 1, 1))

    expect(response.statusCode).toBe(413)
  })

  it('cannot be made ambiguous by a second row', async () => {
    // The CHECK, exercised by a write that skips the API — which is the only kind it
    // exists for. Mutating `schema.ts` would fail nothing: the test database is built
    // from the migration SQL.
    await build()

    expect(() =>
      client()
        .prepare('insert into installation_banner (id, image, updated_at) values (?, ?, ?)')
        .run('other', JPEG, NOW),
    ).toThrow()
  })

  it('takes the one row it does allow, by that same route', async () => {
    // The passing sibling: a CHECK refusing everything would satisfy the test above
    // while making the feature impossible to use.
    const server = await build()

    client()
      .prepare('insert into installation_banner (id, image, updated_at) values (?, ?, ?)')
      .run(INSTALLATION_ID, JPEG, NOW)

    expect((await get(server)).statusCode).toBe(200)
  })

  it('is the admin’s to change, and nobody else’s', async () => {
    // Under `/api/admin/`, so the prefix hook is what refuses — there is no
    // per-route opt-out to forget.
    const server = await build()
    const member = await givenAccount(['member'])

    expect((await put(server, undefined, JPEG)).statusCode).toBe(401)
    expect((await put(server, member, JPEG)).statusCode).toBe(403)
    expect((await remove(server, member)).statusCode).toBe(403)
    expect((await remove(server)).statusCode).toBe(401)
  })
})
