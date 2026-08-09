import type { FastifyInstance } from 'fastify'

import { MAX_CONNECTIONS } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountConnection, accountRole } from '../db/schema.ts'

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

interface Body {
  kind: string
  value: string
  label?: string
}

const add = (server: FastifyInstance, cookie: string | undefined, body: Body) =>
  server.inject({
    method: 'POST',
    url: '/api/me/connections',
    headers: cookie === undefined ? {} : { cookie },
    payload: { label: '', ...body },
  })

const list = (server: FastifyInstance, cookie: string | undefined) =>
  server.inject({
    method: 'GET',
    url: '/api/me/connections',
    headers: cookie === undefined ? {} : { cookie },
  })

const change = (server: FastifyInstance, cookie: string, id: string, body: Body) =>
  server.inject({
    method: 'PATCH',
    url: `/api/me/connections/${id}`,
    headers: { cookie },
    payload: { label: '', ...body },
  })

const remove = (server: FastifyInstance, cookie: string, id: string) =>
  server.inject({ method: 'DELETE', url: `/api/me/connections/${id}`, headers: { cookie } })

const putOrder = (server: FastifyInstance, cookie: string, ids: string[]) =>
  server.inject({ method: 'PUT', url: '/api/me/connections/order', headers: { cookie }, payload: { ids } })

const DISCORD = { kind: 'discord', value: 'wren' }

describe('the ways somebody can be reached', () => {
  it('starts empty and keeps what is added', async () => {
    const server = await build()
    const ada = await givenAccount()

    expect((await list(server, ada.cookie)).json().connections).toEqual([])

    const added = await add(server, ada.cookie, DISCORD)
    expect(added.statusCode).toBe(201)
    expect(added.json().connection).toMatchObject({ kind: 'discord', value: 'wren', order: 0 })

    expect((await list(server, ada.cookie)).json().connections).toHaveLength(1)
  })

  it('numbers each one after the last, per account', async () => {
    const server = await build()
    const ada = await givenAccount()
    const bea = await givenAccount()

    await add(server, ada.cookie, DISCORD)
    const second = await add(server, ada.cookie, { kind: 'instagram', value: '@wren' })

    expect(second.json().connection.order).toBe(1)
    // Numbered within the account: somebody's first way of being reached starts at zero
    // rather than wherever the previous person stopped.
    expect((await add(server, bea.cookie, DISCORD)).json().connection.order).toBe(0)
  })

  it('stores the handle out of a pasted profile URL, whatever the caller sent', async () => {
    // Not only the form's job: the value is stored as authored, and a URL kept whole
    // builds `instagram.com/https://instagram.com/wren`.
    const server = await build()
    const ada = await givenAccount()

    const added = await add(server, ada.cookie, { kind: 'instagram', value: 'https://instagram.com/wren/' })

    expect(added.json().connection.value).toBe('wren')
    expect((await list(server, ada.cookie)).json().connections[0].value).toBe('wren')
  })

  it('counts a pasted URL and its handle as the same one', async () => {
    // Which is the other reason to normalise on the way in: `unique(account_id, kind,
    // value)` would otherwise keep both.
    const server = await build()
    const ada = await givenAccount()
    await add(server, ada.cookie, { kind: 'instagram', value: '@wren' })

    expect(
      (await add(server, ada.cookie, { kind: 'instagram', value: 'https://instagram.com/wren' })).statusCode,
    ).toBe(409)
  })

  it('refuses a handle that is nothing once it is normalised', async () => {
    // `@` passes the schema — one character, trimmed, non-empty — and is nothing at all
    // once the leading `@` comes off. Left to the insert that is a CHECK violation and a
    // 500 where a refusal belongs. Not reachable from the web app, which normalises before
    // sending; reachable from anything else.
    const server = await build()
    const ada = await givenAccount()

    expect((await add(server, ada.cookie, { kind: 'instagram', value: '@' })).statusCode).toBe(400)
    expect((await add(server, ada.cookie, { kind: 'tiktok', value: ' @ ' })).statusCode).toBe(400)
  })

  it('refuses the same emptying on a change, not only on an add', async () => {
    const server = await build()
    const ada = await givenAccount()
    const { id } = (await add(server, ada.cookie, { kind: 'instagram', value: 'wren' })).json().connection

    expect((await change(server, ada.cookie, id, { kind: 'instagram', value: '@' })).statusCode).toBe(400)
    expect((await list(server, ada.cookie)).json().connections[0].value).toBe('wren')
  })

  it('refuses the same handle twice on one account', async () => {
    const server = await build()
    const ada = await givenAccount()
    await add(server, ada.cookie, DISCORD)

    expect((await add(server, ada.cookie, DISCORD)).statusCode).toBe(409)
  })

  it('lets two people list the same handle', async () => {
    // The passing sibling: the uniqueness is per account, not global — two members can
    // perfectly well name the same shared account.
    const server = await build()
    const ada = await givenAccount()
    const bea = await givenAccount()
    await add(server, ada.cookie, DISCORD)

    expect((await add(server, bea.cookie, DISCORD)).statusCode).toBe(201)
  })

  it('refuses a link that is not somewhere a browser should be sent', async () => {
    // The field exists to become an `href`, so this is the one kind whose value is
    // checked rather than merely bounded.
    const server = await build()
    const ada = await givenAccount()

    for (const value of ['javascript:alert(1)', 'http://insecure.example', 'not a url at all']) {
      expect((await add(server, ada.cookie, { kind: 'link', value, label: 'mine' })).statusCode).toBe(400)
    }
  })

  it('takes an https link with a name', async () => {
    const server = await build()
    const ada = await givenAccount()

    const added = await add(server, ada.cookie, {
      kind: 'link',
      value: 'https://wren.example/photos',
      label: 'photos',
    })

    expect(added.statusCode).toBe(201)
  })

  it('refuses a link with nothing to call it', async () => {
    // Every other kind is labelled by its network. A nameless link renders as a bare URL
    // nobody can tell the purpose of.
    const server = await build()
    const ada = await givenAccount()

    const added = await add(server, ada.cookie, { kind: 'link', value: 'https://wren.example', label: ' ' })

    expect(added.statusCode).toBe(400)
  })

  it('refuses a kind it has no way to draw', async () => {
    const server = await build()
    const ada = await givenAccount()

    expect((await add(server, ada.cookie, { kind: 'myspace', value: 'wren' })).statusCode).toBe(400)
  })

  it('refuses an empty value', async () => {
    const server = await build()
    const ada = await givenAccount()

    expect((await add(server, ada.cookie, { kind: 'discord', value: '   ' })).statusCode).toBe(400)
  })

  it('refuses more than one account may list', async () => {
    const server = await build()
    const ada = await givenAccount()
    for (let index = 0; index < MAX_CONNECTIONS; index += 1) {
      await add(server, ada.cookie, { kind: 'link', value: `https://n${index}.example`, label: `n${index}` })
    }

    expect((await add(server, ada.cookie, DISCORD)).statusCode).toBe(409)
  })

  it('still takes the last one below the ceiling', async () => {
    const server = await build()
    const ada = await givenAccount()
    for (let index = 0; index < MAX_CONNECTIONS - 1; index += 1) {
      await add(server, ada.cookie, { kind: 'link', value: `https://n${index}.example`, label: `n${index}` })
    }

    expect((await add(server, ada.cookie, DISCORD)).statusCode).toBe(201)
  })

  it('changes one of your own', async () => {
    const server = await build()
    const ada = await givenAccount()
    const { id } = (await add(server, ada.cookie, DISCORD)).json().connection

    const changed = await change(server, ada.cookie, id, { kind: 'discord', value: 'wren.aldertide' })

    expect(changed.statusCode).toBe(200)
    expect(changed.json().connection.value).toBe('wren.aldertide')
  })

  it('will not change or delete somebody else’s', async () => {
    // The account id is in the `WHERE`, so the id a caller supplies can only ever reach
    // their own row — nobody edits anybody else's record here.
    const server = await build()
    const ada = await givenAccount()
    const bea = await givenAccount()
    const { id } = (await add(server, ada.cookie, DISCORD)).json().connection

    expect((await change(server, bea.cookie, id, { kind: 'discord', value: 'theirs' })).statusCode).toBe(404)
    expect((await remove(server, bea.cookie, id)).statusCode).toBe(404)
    expect((await list(server, ada.cookie)).json().connections[0].value).toBe('wren')
  })

  it('takes one off', async () => {
    const server = await build()
    const ada = await givenAccount()
    const { id } = (await add(server, ada.cookie, DISCORD)).json().connection

    expect((await remove(server, ada.cookie, id)).statusCode).toBe(204)
    expect((await list(server, ada.cookie)).json().connections).toEqual([])
  })

  it('puts them in the order somebody chose', async () => {
    const server = await build()
    const ada = await givenAccount()
    const first = (await add(server, ada.cookie, DISCORD)).json().connection.id
    const second = (await add(server, ada.cookie, { kind: 'instagram', value: '@wren' })).json().connection.id

    const reordered = await putOrder(server, ada.cookie, [second, first])

    expect(reordered.statusCode).toBe(200)
    expect(reordered.json().connections.map((row: { id: string }) => row.id)).toEqual([second, first])
  })

  it('refuses a reorder that does not name every row exactly once', async () => {
    const server = await build()
    const ada = await givenAccount()
    const first = (await add(server, ada.cookie, DISCORD)).json().connection.id
    await add(server, ada.cookie, { kind: 'instagram', value: '@wren' })

    expect((await putOrder(server, ada.cookie, [first])).statusCode).toBe(400)
  })

  it('refuses a reorder naming a row from somebody else’s list', async () => {
    const server = await build()
    const ada = await givenAccount()
    const bea = await givenAccount()
    await add(server, ada.cookie, DISCORD)
    const theirs = (await add(server, bea.cookie, DISCORD)).json().connection.id

    expect((await putOrder(server, ada.cookie, [theirs])).statusCode).toBe(400)
  })

  it('is nobody’s to read or write who is not approved', async () => {
    const server = await build()
    const stranger = await givenAccount([])

    expect((await list(server, stranger.cookie)).statusCode).toBe(403)
    expect((await list(server, undefined)).statusCode).toBe(401)
    expect((await add(server, stranger.cookie, DISCORD)).statusCode).toBe(403)
    expect((await add(server, undefined, DISCORD)).statusCode).toBe(401)
  })

  it('goes with the account when the account goes', async () => {
    const server = await build()
    const ada = await givenAccount()
    await add(server, ada.cookie, DISCORD)

    await db().delete(account).where(eq(account.id, ada.id))

    expect(client().prepare('select count(*) as n from account_connection').get()?.n).toBe(0)
  })

  it('will not hold a kind or a blank value the route would refuse, written straight in', async () => {
    // The CHECKs, which only a write skipping the API can exercise.
    await build()
    const ada = await givenAccount()
    const insert = client().prepare(
      'insert into account_connection (id, account_id, kind, value, label, "order") values (?, ?, ?, ?, ?, ?)',
    )

    expect(() => insert.run(randomUUID(), ada.id, 'myspace', 'wren', '', 0)).toThrow()
    expect(() => insert.run(randomUUID(), ada.id, 'discord', '  ', '', 0)).toThrow()
  })

  it('will not hold the same handle twice, written straight in', async () => {
    await build()
    const ada = await givenAccount()
    await db()
      .insert(accountConnection)
      .values({ id: randomUUID(), account_id: ada.id, kind: 'discord', value: 'wren', label: '', order: 0 })

    expect(() =>
      client()
        .prepare(
          'insert into account_connection (id, account_id, kind, value, label, "order") values (?, ?, ?, ?, ?, ?)',
        )
        .run(randomUUID(), ada.id, 'discord', 'wren', '', 1),
    ).toThrow()
  })
})
