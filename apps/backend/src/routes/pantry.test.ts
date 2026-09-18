import type { PantryItem, PantryListResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole } from '../db/schema.ts'

const SECRET = 'p'.repeat(40)
const NOW = '2026-09-18T10:00:00.000Z'

let handle: DbHandle | undefined
let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  handle?.close()
  app = undefined
  handle = undefined
})

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

const givenAccount = async (name: string, roles: ('admin' | 'member')[] = ['member']) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, name, password_hash: null, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(NOW), ttlSeconds: 3600 })

  return { id, name, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
}

const list = async (server: FastifyInstance, cookie: string): Promise<PantryListResponse> =>
  (await server.inject({ method: 'GET', url: '/api/pantry', headers: { cookie } })).json()

const add = (server: FastifyInstance, cookie: string, payload: Record<string, unknown>) =>
  server.inject({ method: 'POST', url: '/api/admin/pantry', headers: { cookie }, payload })

const edit = (server: FastifyInstance, cookie: string, id: string, payload: Record<string, unknown>) =>
  server.inject({ method: 'PATCH', url: `/api/admin/pantry/${id}`, headers: { cookie }, payload })

const withdraw = (server: FastifyInstance, cookie: string, id: string) =>
  server.inject({ method: 'DELETE', url: `/api/admin/pantry/${id}`, headers: { cookie } })

const restore = (server: FastifyInstance, cookie: string, id: string) =>
  server.inject({ method: 'POST', url: `/api/admin/pantry/${id}/restore`, headers: { cookie } })

const count = (
  server: FastifyInstance,
  cookie: string,
  id: string,
  payload: { amount: number | null; level: string | null },
) => server.inject({ method: 'PUT', url: `/api/pantry/${id}/stock`, headers: { cookie }, payload })

const given = async (server: FastifyInstance, cookie: string, name: string, kind = 'staple') => {
  const made = await add(server, cookie, { kind, name })
  const item: PantryItem = made.json().item

  return item
}

describe('the pantry a member reads', () => {
  it('comes seeded, so the first person to open it has something to count', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')

    const { items } = await list(server, ada.cookie)

    const oatmeal = items.find((item) => item.name === 'Oatmeal')
    expect(oatmeal?.kind).toBe('breakfast')
    expect(oatmeal?.unit).toBe('kg')
    expect(oatmeal?.stock_level).toBeNull()
    expect(items.some((item) => item.name === 'Toilet paper')).toBe(true)
  })

  it('is ordered by name whatever the capitals', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin', 'member'])

    await given(server, ada.cookie, 'aubergine')
    await given(server, ada.cookie, 'Basil')

    const { items } = await list(server, ada.cookie)
    const names = items.map((item) => item.name)

    expect(names.indexOf('aubergine')).toBeLessThan(names.indexOf('Basil'))
  })

  it('carries the rows somebody took off, since the page tells the two apart', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin', 'member'])
    const gone = await given(server, ada.cookie, 'Marmite')

    await withdraw(server, ada.cookie, gone.id)

    const { items } = await list(server, ada.cookie)

    expect(items.find((item) => item.id === gone.id)?.withdrawn_at).toBe(NOW)
  })

  it('is no business of somebody signed out', async () => {
    const server = await build()

    const answer = await server.inject({ method: 'GET', url: '/api/pantry' })

    expect(answer.statusCode).toBe(401)
  })

  it('is not for an account with no role yet', async () => {
    const server = await build()
    const newcomer = await givenAccount('Nils', [])

    const answer = await server.inject({
      method: 'GET',
      url: '/api/pantry',
      headers: { cookie: newcomer.cookie },
    })

    expect(answer.statusCode).toBe(403)
  })
})

describe('counting a thing, which any member may do', () => {
  it('writes the level and stamps who counted and when', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')
    const { items } = await list(server, ada.cookie)
    const oatmeal = items.find((item) => item.name === 'Oatmeal')

    const written = await count(server, ada.cookie, oatmeal?.id ?? '', { amount: null, level: 'plenty' })

    expect(written.statusCode).toBe(200)
    const item: PantryItem = written.json().item
    expect(item.stock_level).toBe('plenty')
    expect(item.counted_by).toBe(ada.id)
    expect(item.counted_by_name).toBe('Ada')
    expect(item.counted_at).toBe(NOW)
  })

  it('keeps the rough amount beside some', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin', 'member'])
    const rice = await given(server, ada.cookie, 'Rice')

    const written = await count(server, ada.cookie, rice.id, { amount: 2.5, level: 'some' })

    expect(written.statusCode).toBe(200)
    expect(written.json().item.stock_amount).toBe(2.5)
  })

  it('refuses an amount beside a level that is not some', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin', 'member'])
    const rice = await given(server, ada.cookie, 'Rice')

    const written = await count(server, ada.cookie, rice.id, { amount: 2, level: 'plenty' })

    expect(written.statusCode).toBe(400)
  })

  it('forgets who counted when the count is cleared, since nothing has been counted then', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin', 'member'])
    const rice = await given(server, ada.cookie, 'Rice')
    await count(server, ada.cookie, rice.id, { amount: 2, level: 'some' })

    const cleared = await count(server, ada.cookie, rice.id, { amount: null, level: null })

    const item: PantryItem = cleared.json().item
    expect(item.stock_level).toBeNull()
    expect(item.stock_amount).toBeNull()
    expect(item.counted_by).toBeNull()
    expect(item.counted_at).toBeNull()
  })

  it('refuses a row somebody took off the list', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin', 'member'])
    const gone = await given(server, ada.cookie, 'Marmite')
    await withdraw(server, ada.cookie, gone.id)

    const written = await count(server, ada.cookie, gone.id, { amount: null, level: 'out' })

    expect(written.statusCode).toBe(404)
  })

  it('is refused to somebody signed out', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin', 'member'])
    const rice = await given(server, ada.cookie, 'Rice')

    const written = await server.inject({
      method: 'PUT',
      url: `/api/pantry/${rice.id}/stock`,
      payload: { amount: null, level: 'out' },
    })

    expect(written.statusCode).toBe(401)
  })
})

describe('what is on the list, which is the admin’s', () => {
  it('adds one, defaulting the unit and leaving the place empty', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])

    const made = await add(server, ada.cookie, { kind: 'spice', name: 'Cumin' })

    expect(made.statusCode).toBe(201)
    const item: PantryItem = made.json().item
    expect(item.unit).toBe('pcs')
    expect(item.where).toBe('')
    expect(item.created_at).toBe(NOW)
  })

  it('refuses a member', async () => {
    const server = await build()
    const bo = await givenAccount('Bo')

    const made = await add(server, bo.cookie, { kind: 'spice', name: 'Cumin' })

    expect(made.statusCode).toBe(403)
  })

  it('refuses a member the pencil and the bin as well', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])
    const bo = await givenAccount('Bo')
    const cumin = await given(server, ada.cookie, 'Cumin', 'spice')

    expect((await edit(server, bo.cookie, cumin.id, { name: 'Kummin' })).statusCode).toBe(403)
    expect((await withdraw(server, bo.cookie, cumin.id)).statusCode).toBe(403)
    expect((await restore(server, bo.cookie, cumin.id)).statusCode).toBe(403)
  })

  it('will not have the same thing twice, whatever the capitals', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])
    await given(server, ada.cookie, 'Cumin', 'spice')

    const again = await add(server, ada.cookie, { kind: 'spice', name: '  cumin ' })

    expect(again.statusCode).toBe(409)
    expect(again.json().error).toBe('conflict')
  })

  it('will not have it twice against a row taken off either, which is what restore is for', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])
    const cumin = await given(server, ada.cookie, 'Cumin', 'spice')
    await withdraw(server, ada.cookie, cumin.id)

    const again = await add(server, ada.cookie, { kind: 'spice', name: 'CUMIN' })

    expect(again.statusCode).toBe(409)
  })

  it('renames one, and the place and the unit with it', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])
    const cumin = await given(server, ada.cookie, 'Cumin', 'spice')

    const written = await edit(server, ada.cookie, cumin.id, {
      name: 'Kummin',
      unit: 'g',
      where: 'Hallway bucket · cellar I',
    })

    expect(written.statusCode).toBe(200)
    const item: PantryItem = written.json().item
    expect(item.name).toBe('Kummin')
    expect(item.unit).toBe('g')
    expect(item.where).toBe('Hallway bucket · cellar I')
  })

  it('refuses a rename onto a name already taken, withdrawn or not', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])
    const cumin = await given(server, ada.cookie, 'Cumin', 'spice')
    const dill = await given(server, ada.cookie, 'Dill', 'spice')
    await withdraw(server, ada.cookie, dill.id)

    expect((await edit(server, ada.cookie, cumin.id, { name: 'dill' })).statusCode).toBe(409)
  })

  it('lets a row keep its own name', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])
    const cumin = await given(server, ada.cookie, 'Cumin', 'spice')

    expect((await edit(server, ada.cookie, cumin.id, { name: 'Cumin', unit: 'g' })).statusCode).toBe(200)
  })

  it('refuses a patch that asks for nothing', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])
    const cumin = await given(server, ada.cookie, 'Cumin', 'spice')

    expect((await edit(server, ada.cookie, cumin.id, {})).statusCode).toBe(400)
  })

  it('takes one off softly, and says so again when it is already off', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])
    const cumin = await given(server, ada.cookie, 'Cumin', 'spice')

    expect((await withdraw(server, ada.cookie, cumin.id)).statusCode).toBe(204)
    expect((await withdraw(server, ada.cookie, cumin.id)).statusCode).toBe(204)
  })

  it('puts one back, count and all', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin', 'member'])
    const cumin = await given(server, ada.cookie, 'Cumin', 'spice')
    await count(server, ada.cookie, cumin.id, { amount: null, level: 'plenty' })
    await withdraw(server, ada.cookie, cumin.id)

    const back = await restore(server, ada.cookie, cumin.id)

    expect(back.statusCode).toBe(200)
    const item: PantryItem = back.json().item
    expect(item.withdrawn_at).toBeNull()
    expect(item.stock_level).toBe('plenty')
  })

  it('has nothing to take off or put back that is not there', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])
    const nobody = randomUUID()

    expect((await withdraw(server, ada.cookie, nobody)).statusCode).toBe(404)
    expect((await restore(server, ada.cookie, nobody)).statusCode).toBe(404)
    expect((await edit(server, ada.cookie, nobody, { name: 'Cumin' })).statusCode).toBe(404)
  })
})

describe('what the table itself refuses, which no route has to be trusted for', () => {
  const insert = (values: Record<string, null | number | string>) => {
    const columns = Object.keys(values)
    const statement = client().prepare(
      `INSERT INTO pantry_item (${columns.map((column) => `"${column}"`).join(', ')}) ` +
        `VALUES (${columns.map(() => '?').join(', ')})`,
    )

    return () => statement.run(...Object.values(values))
  }

  const row = (over: Record<string, null | number | string> = {}) => ({
    id: randomUUID(),
    kind: 'staple',
    name: `Rice ${randomUUID()}`,
    unit: 'kg',
    where: '',
    created_at: NOW,
    ...over,
  })

  it('takes an ordinary row', async () => {
    await build()

    expect(insert(row())).not.toThrow()
  })

  it('refuses a kind nobody named', async () => {
    await build()

    expect(insert(row({ kind: 'pudding' }))).toThrow()
  })

  it('refuses a name that is only spaces', async () => {
    await build()

    expect(insert(row({ name: '   ' }))).toThrow()
  })

  it('refuses an empty unit', async () => {
    await build()

    expect(insert(row({ unit: '' }))).toThrow()
  })

  it('refuses a stock level nobody named', async () => {
    await build()

    expect(insert(row({ stock_level: 'lots' }))).toThrow()
  })

  it('takes a count of some with an amount, and refuses that amount anywhere else', async () => {
    await build()

    expect(insert(row({ stock_amount: 2, stock_level: 'some' }))).not.toThrow()
    expect(insert(row({ stock_amount: 2, stock_level: 'plenty' }))).toThrow()
    expect(insert(row({ stock_amount: 2, stock_level: null }))).toThrow()
  })

  it('refuses an amount below nothing', async () => {
    await build()

    expect(insert(row({ stock_amount: -1, stock_level: 'some' }))).toThrow()
  })

  it('refuses the same name twice, withdrawn or not', async () => {
    await build()

    expect(insert(row({ name: 'Pepper' }))).not.toThrow()
    expect(insert(row({ name: ' pepper ' }))).toThrow()
    expect(insert(row({ name: 'PEPPER', withdrawn_at: NOW }))).toThrow()
  })
})
