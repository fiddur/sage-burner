import type { FastifyInstance } from 'fastify'

import { MAX_IMAGE_BYTES, MAX_IMAGES_PER_ACCOUNT } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, image } from '../db/schema.ts'

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

const client = () => {
  const found = handle?.client
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
  body: Buffer = PNG,
  contentType = 'image/png',
) =>
  server.inject({
    method: 'POST',
    url: '/api/images',
    headers: { ...(cookie === undefined ? {} : { cookie }), 'content-type': contentType },
    payload: body,
  })

const fetchImage = (server: FastifyInstance, cookie: string | undefined, id: string) =>
  server.inject({ method: 'GET', url: `/api/images/${id}`, headers: cookie === undefined ? {} : { cookie } })

/** Rows straight into the table, to stand a member near their ceiling cheaply. */
const givenStoredImages = async (accountId: string, howMany: number) => {
  for (let index = 0; index < howMany; index += 1) {
    await db().insert(image).values({
      id: randomUUID(),
      bytes: PNG,
      content_type: 'image/png',
      uploaded_by: accountId,
      created_at: NOW,
    })
  }
}

describe('a picture written into markdown', () => {
  it('stores what was sent and gives back the same bytes', async () => {
    const server = await build()
    const ada = await givenAccount()

    const stored = await upload(server, ada.cookie)
    expect(stored.statusCode).toBe(201)

    const got = await fetchImage(server, ada.cookie, stored.json().id)
    expect(got.statusCode).toBe(200)
    expect(got.headers['content-type']).toBe('image/png')
    expect(got.rawPayload.equals(PNG)).toBe(true)
  })

  it('keeps both when two are uploaded, unlike the one-per-person slots', async () => {
    const server = await build()
    const ada = await givenAccount()
    const other = Buffer.concat([PNG, Buffer.from([0])])

    const first = await upload(server, ada.cookie)
    const second = await upload(server, ada.cookie, other, 'image/webp')

    expect(second.json().id).not.toBe(first.json().id)
    expect((await fetchImage(server, ada.cookie, first.json().id)).rawPayload.equals(PNG)).toBe(true)
    expect((await fetchImage(server, ada.cookie, second.json().id)).rawPayload.equals(other)).toBe(true)
  })

  it('refuses a type it will not serve back', async () => {
    // The content type is whatever the caller claims and is echoed on the way out, so
    // the list of what can be stored is the list of what can be served. SVG is refused
    // where the icon takes it: that one is served `default-src 'none'; sandbox`, and
    // this one is not.
    const server = await build()
    const ada = await givenAccount()

    expect((await upload(server, ada.cookie, PNG, 'image/svg+xml')).statusCode).toBe(415)
    expect((await upload(server, ada.cookie, PNG, 'text/html')).statusCode).toBe(415)
  })

  it('takes the three formats a browser can produce', async () => {
    // The passing sibling: a check that refused everything would satisfy the test above
    // while making the feature impossible to use.
    const server = await build()
    const ada = await givenAccount()

    expect((await upload(server, ada.cookie, PNG, 'image/png')).statusCode).toBe(201)
    expect((await upload(server, ada.cookie, PNG, 'image/jpeg')).statusCode).toBe(201)
    expect((await upload(server, ada.cookie, PNG, 'image/webp')).statusCode).toBe(201)
  })

  it('refuses one too big to be a resized picture', async () => {
    const server = await build()
    const ada = await givenAccount()

    expect((await upload(server, ada.cookie, Buffer.alloc(MAX_IMAGE_BYTES + 1, 1))).statusCode).toBe(413)
  })

  it('refuses an empty body', async () => {
    const server = await build()
    const ada = await givenAccount()

    expect((await upload(server, ada.cookie, Buffer.alloc(0))).statusCode).toBe(400)
  })

  it('is another member’s to see, like the prose it is written into', async () => {
    const server = await build()
    const ada = await givenAccount()
    const bea = await givenAccount()
    const stored = await upload(server, ada.cookie)

    expect((await fetchImage(server, bea.cookie, stored.json().id)).statusCode).toBe(200)
  })

  it('is nobody’s to upload who is not approved', async () => {
    const server = await build()
    const stranger = await givenAccount([])

    expect((await upload(server, stranger.cookie)).statusCode).toBe(403)
    expect((await upload(server, undefined)).statusCode).toBe(401)
  })

  it('is read by anybody, so the burn’s welcome text can carry one', async () => {
    const server = await build()
    const ada = await givenAccount()
    const stored = await upload(server, ada.cookie)

    const anonymous = await fetchImage(server, undefined, stored.json().id)

    expect(anonymous.statusCode).toBe(200)
    expect(anonymous.rawPayload.equals(PNG)).toBe(true)
  })

  it('answers 404 to a stranger asking for one that is not there', async () => {
    const server = await build()

    expect((await fetchImage(server, undefined, randomUUID())).statusCode).toBe(404)
  })

  it('will not let a browser decide the bytes are something else', async () => {
    const server = await build()
    const ada = await givenAccount()
    const stored = await upload(server, ada.cookie)

    expect((await fetchImage(server, ada.cookie, stored.json().id)).headers['x-content-type-options']).toBe(
      'nosniff',
    )
  })

  it('may be cached hard, because an id never answers with different bytes', async () => {
    const server = await build()
    const ada = await givenAccount()
    const stored = await upload(server, ada.cookie)

    const cacheControl = (await fetchImage(server, ada.cookie, stored.json().id)).headers['cache-control']

    expect(cacheControl).toContain('private')
    expect(cacheControl).toContain('immutable')
  })

  it('answers 404 for an id nothing was stored under', async () => {
    const server = await build()
    const ada = await givenAccount()

    expect((await fetchImage(server, ada.cookie, randomUUID())).statusCode).toBe(404)
  })

  it('refuses to store more than one account may hold', async () => {
    const server = await build()
    const ada = await givenAccount()
    await givenStoredImages(ada.id, MAX_IMAGES_PER_ACCOUNT)

    expect((await upload(server, ada.cookie)).statusCode).toBe(409)
  })

  it('still takes the last one below the ceiling', async () => {
    const server = await build()
    const ada = await givenAccount()
    await givenStoredImages(ada.id, MAX_IMAGES_PER_ACCOUNT - 1)

    expect((await upload(server, ada.cookie)).statusCode).toBe(201)
  })

  it('counts each account’s own, so one member cannot spend another’s', async () => {
    const server = await build()
    const ada = await givenAccount()
    const bea = await givenAccount()
    await givenStoredImages(ada.id, MAX_IMAGES_PER_ACCOUNT)

    expect((await upload(server, bea.cookie)).statusCode).toBe(201)
  })

  it('goes with the account when the account goes', async () => {
    const server = await build()
    const ada = await givenAccount()
    await upload(server, ada.cookie)

    await db().delete(account).where(eq(account.id, ada.id))

    expect(client().prepare('select count(*) as n from image').get()?.n).toBe(0)
  })

  it('lists what one account has stored, newest first, and nobody else’s', async () => {
    const server = await build()
    const ada = await givenAccount()
    const bea = await givenAccount()
    const older = await upload(server, ada.cookie)
    await db()
      .update(image)
      .set({ created_at: '2026-07-01T00:00:00.000Z' })
      .where(eq(image.id, older.json().id))
    const newer = await upload(server, ada.cookie)
    await upload(server, bea.cookie)

    const listed = await server.inject({
      method: 'GET',
      url: '/api/me/images',
      headers: { cookie: ada.cookie },
    })

    expect(listed.statusCode).toBe(200)
    expect(listed.json().images.map((row: { id: string }) => row.id)).toEqual([
      newer.json().id,
      older.json().id,
    ])
  })

  it('carries no bytes in the list, which would be megabytes apiece', async () => {
    const server = await build()
    const ada = await givenAccount()
    await upload(server, ada.cookie)

    const listed = await server.inject({
      method: 'GET',
      url: '/api/me/images',
      headers: { cookie: ada.cookie },
    })

    expect(Object.keys(listed.json().images[0]).sort()).toEqual(['created_at', 'id'])
  })

  it('frees a slot when one is taken off, so the ceiling is recoverable', async () => {
    // The dead end this route exists for: the cap counts every row ever written, so an
    // account at the ceiling could not upload again by any action the app offered.
    const server = await build()
    const ada = await givenAccount()
    await givenStoredImages(ada.id, MAX_IMAGES_PER_ACCOUNT - 1)
    const last = await upload(server, ada.cookie)
    expect((await upload(server, ada.cookie)).statusCode).toBe(409)

    const removed = await server.inject({
      method: 'DELETE',
      url: `/api/me/images/${last.json().id}`,
      headers: { cookie: ada.cookie },
    })

    expect(removed.statusCode).toBe(204)
    expect((await upload(server, ada.cookie)).statusCode).toBe(201)
  })

  it('refuses to take off somebody else’s, and leaves it where it is', async () => {
    const server = await build()
    const ada = await givenAccount()
    const bea = await givenAccount()
    const hers = await upload(server, ada.cookie)

    const attempt = await server.inject({
      method: 'DELETE',
      url: `/api/me/images/${hers.json().id}`,
      headers: { cookie: bea.cookie },
    })

    expect(attempt.statusCode).toBe(404)
    expect((await fetchImage(server, ada.cookie, hers.json().id)).statusCode).toBe(200)
  })

  it('is nobody’s to list or take off while signed out', async () => {
    const server = await build()
    const ada = await givenAccount()
    const hers = await upload(server, ada.cookie)

    expect((await server.inject({ method: 'GET', url: '/api/me/images' })).statusCode).toBe(401)
    expect(
      (await server.inject({ method: 'DELETE', url: `/api/me/images/${hers.json().id}` })).statusCode,
    ).toBe(401)
  })

  it('will not hold a type the route would refuse, even written straight to the table', async () => {
    // The CHECK, which only a write skipping the API can exercise.
    await build()
    const ada = await givenAccount()

    expect(() =>
      client()
        .prepare(
          'insert into image (id, bytes, content_type, uploaded_by, created_at) values (?, ?, ?, ?, ?)',
        )
        .run(randomUUID(), PNG, 'image/svg+xml', ada.id, NOW),
    ).toThrow()
  })
})
