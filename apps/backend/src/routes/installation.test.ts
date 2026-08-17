import type { FastifyInstance } from 'fastify'

import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, installation, INSTALLATION_ID } from '../db/schema.ts'

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

const givenAccount = async (roles: ('admin' | 'member')[]) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return { id, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
}

const readTitle = (server: FastifyInstance) => server.inject({ method: 'GET', url: '/api/installation' })

const rename = (server: FastifyInstance, cookie: string | undefined, payload: Record<string, unknown>) =>
  server.inject({
    method: 'PATCH',
    url: '/api/admin/installation',
    headers: cookie === undefined ? {} : { cookie },
    payload,
  })

const storedTitle = async () => (await db().select().from(installation))[0]?.title

describe('what this installation calls itself', () => {
  it('is readable by anyone, since it is on every page including the public ones', async () => {
    const server = await build()

    const response = await readTitle(server)

    expect(response.statusCode).toBe(200)
    expect(response.json().installation.title).toBe('Sage Burner')
  })

  it('is the software name until an admin says otherwise', async () => {
    const server = await build()

    expect((await readTitle(server)).json().installation.title).toBe('Sage Burner')
  })

  it('is renamed by an admin, and the public read reflects it', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])

    const response = await rename(server, admin.cookie, { title: 'The Burning Sage' })

    expect(response.statusCode).toBe(200)
    expect(response.json().installation.title).toBe('The Burning Sage')
    expect((await readTitle(server)).json().installation.title).toBe('The Burning Sage')
  })

  it('trims the title rather than storing the spaces', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])

    await rename(server, admin.cookie, { title: '  The Burning Sage  ' })

    expect(await storedTitle()).toBe('The Burning Sage')
  })

  it('refuses a blank title, which would leave the header with nothing to show', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])

    expect((await rename(server, admin.cookie, { title: '' })).statusCode).toBe(400)
    expect((await rename(server, admin.cookie, { title: '   ' })).statusCode).toBe(400)
    expect(await storedTitle()).toBe('Sage Burner')
  })

  it('refuses a title long enough to be storage', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])

    expect((await rename(server, admin.cookie, { title: 'x'.repeat(201) })).statusCode).toBe(400)
    expect((await rename(server, admin.cookie, { title: 'x'.repeat(200) })).statusCode).toBe(200)
  })

  it('refuses a key it does not know, rather than silently ignoring it', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])

    expect((await rename(server, admin.cookie, { name: 'The Burning Sage' })).statusCode).toBe(400)
    expect(await storedTitle()).toBe('Sage Burner')
  })

  it('treats an empty body as a read rather than a 500', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])

    const response = await rename(server, admin.cookie, {})

    expect(response.statusCode).toBe(200)
    expect(response.json().installation.title).toBe('Sage Burner')
  })

  it('refuses anyone who is not an admin', async () => {
    const server = await build()
    const member = await givenAccount(['member'])

    expect((await rename(server, undefined, { title: 'Theirs' })).statusCode).toBe(401)
    expect((await rename(server, member.cookie, { title: 'Theirs' })).statusCode).toBe(403)
    expect(await storedTitle()).toBe('Sage Burner')
  })

  it('cannot be blanked by a write that skips the API', async () => {
    await build()

    expect(() =>
      client().prepare('update installation set title = ? where id = ?').run('   ', INSTALLATION_ID),
    ).toThrow()
  })

  it('cannot be made ambiguous by a second row', async () => {
    await build()

    expect(() =>
      client().prepare('insert into installation (id, title) values (?, ?)').run('other', 'Theirs'),
    ).toThrow()
  })
})

describe('the link to the map of the area', () => {
  const readMap = (server: FastifyInstance, cookie?: string) =>
    server.inject({ method: 'GET', url: '/api/map', headers: cookie === undefined ? {} : { cookie } })

  const setMap = (server: FastifyInstance, cookie: string | undefined, payload: Record<string, unknown>) =>
    server.inject({
      method: 'PUT',
      url: '/api/admin/map',
      headers: cookie === undefined ? {} : { cookie },
      payload,
    })

  const MAP = 'https://maps.example.org/the-field'

  it('is nothing until an admin sets one', async () => {
    const server = await build()
    const member = await givenAccount(['member'])

    expect((await readMap(server, member.cookie)).json().map.url).toBeNull()
  })

  it('is set by an admin and read by any approved member', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const member = await givenAccount(['member'])

    const written = await setMap(server, admin.cookie, { url: MAP })

    expect(written.statusCode).toBe(200)
    expect(written.json().map.url).toBe(MAP)
    expect((await readMap(server, member.cookie)).json().map.url).toBe(MAP)
  })

  it('is not on the public read, because where the gathering is is not a visitor’s to know', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    await setMap(server, admin.cookie, { url: MAP })

    const public_read = await readTitle(server)

    expect(public_read.statusCode).toBe(200)
    expect(JSON.stringify(public_read.json())).not.toContain('maps.example.org')
  })

  it('is refused to somebody signed out and to somebody with no role', async () => {
    const server = await build()
    const nobody = await givenAccount([])

    expect((await readMap(server)).statusCode).toBe(401)
    expect((await readMap(server, nobody.cookie)).statusCode).toBe(403)
  })

  it('is an admin’s to set, and nobody else’s', async () => {
    const server = await build()
    const member = await givenAccount(['member'])

    expect((await setMap(server, undefined, { url: MAP })).statusCode).toBe(401)
    expect((await setMap(server, member.cookie, { url: MAP })).statusCode).toBe(403)
  })

  it('takes it away again when the address is cleared', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    await setMap(server, admin.cookie, { url: MAP })

    const cleared = await setMap(server, admin.cookie, { url: null })

    expect(cleared.json().map.url).toBeNull()
  })

  it('refuses anything a browser should not be sent to', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])

    for (const url of ['javascript:alert(1)', 'http://maps.example.org', 'maps.example.org', '']) {
      expect((await setMap(server, admin.cookie, { url })).statusCode, url).toBe(400)
    }
  })

  it('trims the address rather than storing the spaces', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])

    await setMap(server, admin.cookie, { url: `  ${MAP}  ` })

    expect((await readMap(server, admin.cookie)).json().map.url).toBe(MAP)
  })
})
