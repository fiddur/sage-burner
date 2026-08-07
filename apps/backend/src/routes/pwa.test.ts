import type { FastifyInstance } from 'fastify'

import { flameIcon, MAX_ICON_BYTES } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, INSTALLATION_ID, installation } from '../db/schema.ts'

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

const givenAccount = async (roles: ('admin' | 'member')[] = ['admin']) => {
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

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"></svg>', 'utf8')

const putIcon = (
  server: FastifyInstance,
  cookie: string | undefined,
  body: Buffer,
  contentType = 'image/png',
) =>
  server.inject({
    method: 'PUT',
    url: '/api/admin/installation/icon',
    headers: { ...(cookie === undefined ? {} : { cookie }), 'content-type': contentType },
    payload: body,
  })

const getIcon = (server: FastifyInstance) => server.inject({ method: 'GET', url: '/api/installation/icon' })

const getManifest = (server: FastifyInstance) =>
  server.inject({ method: 'GET', url: '/manifest.webmanifest' })

describe('the web manifest', () => {
  it('names the installation rather than the software', async () => {
    const server = await build()
    await db()
      .update(installation)
      .set({ title: 'The Burning Sage' })
      .where(eq(installation.id, INSTALLATION_ID))

    const response = await getManifest(server)

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('application/manifest+json')
    expect(response.json()).toMatchObject({
      name: 'The Burning Sage',
      short_name: 'The Burning Sage',
      start_url: '/',
      display: 'standalone',
    })
  })

  it('names a splash colour from the dark palette, which is where most phones are', async () => {
    // A manifest colour cannot follow `prefers-color-scheme`, so one of the two is
    // wrong. The light one showed as a cream strip behind Android's gesture bar for
    // as long as the app was open; this one is wrong only for the length of a launch.
    const server = await build()

    expect((await getManifest(server)).json()).toMatchObject({
      theme_color: '#c2410c',
      background_color: '#1c1917',
    })
  })

  it('is readable by somebody who is not signed in', async () => {
    // The homepage is public and so is installing from it, so neither of these may
    // depend on a cookie. Both are also fetched by the browser itself, which does not
    // send one.
    const server = await build()

    expect((await getManifest(server)).statusCode).toBe(200)
    expect((await getIcon(server)).statusCode).toBe(200)
  })

  it('points at the uploaded icon, versioned so a new one is a new URL', async () => {
    const server = await build()
    const root = await givenAccount()

    const before = (await getManifest(server)).json()
    expect(before.icons[0].src).toBe('/api/installation/icon?v=default')
    expect(before.icons[0]).toMatchObject({ type: 'image/svg+xml', sizes: 'any' })

    expect((await putIcon(server, root.cookie, PNG)).statusCode).toBe(200)

    const after = (await getManifest(server)).json()
    expect(after.icons[0].src).toBe(`/api/installation/icon?v=${NOW}`)
    expect(after.icons[0]).toMatchObject({ type: 'image/png', sizes: '512x512' })
  })

  it('offers an uploaded icon as maskable, so Android does not plate it in white', async () => {
    const server = await build()
    const root = await givenAccount()

    // The flame is not offered maskable: it is an emoji in the top left of its box,
    // and a launcher's circular mask would cut it.
    expect((await getManifest(server)).json().icons.map((icon: { purpose: string }) => icon.purpose)).toEqual(
      ['any'],
    )

    expect((await putIcon(server, root.cookie, PNG)).statusCode).toBe(200)

    expect((await getManifest(server)).json().icons.map((icon: { purpose: string }) => icon.purpose)).toEqual(
      ['any maskable'],
    )
  })

  it('names the icon once however many purposes it serves', async () => {
    // The same `src` listed once per purpose is what killed Pixel Launcher on "add
    // to home screen": Firefox built two icon records from one URL, and a 512-square
    // bitmap is already the whole of what a binder transaction may carry.
    const server = await build()
    const root = await givenAccount()

    expect((await putIcon(server, root.cookie, PNG)).statusCode).toBe(200)

    const { icons } = (await getManifest(server)).json()
    expect(icons).toHaveLength(1)
    expect(new Set(icons.map((icon: { src: string }) => icon.src)).size).toBe(1)
  })
})

describe('the app icon', () => {
  it('serves the app flame until somebody uploads one', async () => {
    const server = await build()

    const response = await getIcon(server)

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('image/svg+xml')
    expect(response.rawPayload.toString('utf8')).toBe(flameIcon())
  })

  it('gives back the bytes it was given, with the type they were sent as', async () => {
    const server = await build()
    const root = await givenAccount()

    expect((await putIcon(server, root.cookie, PNG)).statusCode).toBe(200)

    const response = await getIcon(server)
    expect(response.headers['content-type']).toBe('image/png')
    expect(response.rawPayload.equals(PNG)).toBe(true)
  })

  it('stores an SVG as authored rather than rasterising it', async () => {
    const server = await build()
    const root = await givenAccount()

    expect((await putIcon(server, root.cookie, SVG, 'image/svg+xml')).statusCode).toBe(200)

    const response = await getIcon(server)
    expect(response.headers['content-type']).toBe('image/svg+xml')
    expect(response.rawPayload.equals(SVG)).toBe(true)
  })

  it('cannot be run as a page even though an SVG may carry script', async () => {
    // The trade #256 settled: an admin's own SVG is trusted, and navigating straight
    // to it is the one place it could execute. `sandbox` gives that document an opaque
    // origin, so a script in there reaches nothing of this app's.
    const server = await build()
    const root = await givenAccount()
    await putIcon(server, root.cookie, SVG, 'image/svg+xml')

    const response = await getIcon(server)

    expect(response.headers['content-security-policy']).toBe("default-src 'none'; sandbox")
    expect(response.headers['x-content-type-options']).toBe('nosniff')
  })

  it('refuses a type it will not serve back', async () => {
    const server = await build()
    const root = await givenAccount()

    expect((await putIcon(server, root.cookie, PNG, 'image/jpeg')).statusCode).toBe(415)
    expect((await putIcon(server, root.cookie, PNG, 'text/html')).statusCode).toBe(415)
  })

  it('refuses one too big to be a resized icon', async () => {
    const server = await build()
    const root = await givenAccount()

    const response = await putIcon(server, root.cookie, Buffer.alloc(MAX_ICON_BYTES + 1, 1))

    expect(response.statusCode).toBe(413)
  })

  it('refuses an empty body', async () => {
    const server = await build()
    const root = await givenAccount()

    expect((await putIcon(server, root.cookie, Buffer.alloc(0))).statusCode).toBe(400)
  })

  it('is an admin to set, never a member', async () => {
    const server = await build()
    const member = await givenAccount(['member'])

    expect((await putIcon(server, member.cookie, PNG)).statusCode).toBe(403)
    expect((await putIcon(server, undefined, PNG)).statusCode).toBe(401)
  })

  it('cannot be stored as a type the route would refuse, even by a write that skips it', async () => {
    // The route's 415 is the boundary; the CHECK is what holds for a migration or a
    // repair by hand. Without it, an `image/svg+xml` ban at the API would still leave
    // `text/html` servable from this URL by anything that wrote the row directly.
    await build()

    expect(() =>
      client()
        .prepare('insert into installation_icon (id, image, content_type, updated_at) values (?, ?, ?, ?)')
        .run(INSTALLATION_ID, PNG, 'text/html', NOW),
    ).toThrow()
  })

  it('stores the two types it does allow, by that same route', async () => {
    // The passing sibling: a CHECK refusing everything would satisfy the test above
    // while making the feature impossible to use.
    const server = await build()

    for (const type of ['image/png', 'image/svg+xml']) {
      client()
        .prepare(
          'insert into installation_icon (id, image, content_type, updated_at) values (?, ?, ?, ?) ' +
            'on conflict(id) do update set content_type = excluded.content_type',
        )
        .run(INSTALLATION_ID, PNG, type, NOW)
    }

    expect((await getIcon(server)).headers['content-type']).toBe('image/svg+xml')
  })

  it('cannot be made ambiguous by a second row', async () => {
    await build()

    expect(() =>
      client()
        .prepare('insert into installation_icon (id, image, content_type, updated_at) values (?, ?, ?, ?)')
        .run('other', PNG, 'image/png', NOW),
    ).toThrow()
  })

  it('falls back to the flame again once it is removed', async () => {
    const server = await build()
    const root = await givenAccount()
    await putIcon(server, root.cookie, PNG)

    const removed = await server.inject({
      method: 'DELETE',
      url: '/api/admin/installation/icon',
      headers: { cookie: root.cookie },
    })
    expect(removed.statusCode).toBe(204)

    const response = await getIcon(server)
    expect(response.headers['content-type']).toBe('image/svg+xml')
    expect(response.rawPayload.toString('utf8')).toBe(flameIcon())
  })
})
