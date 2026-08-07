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
import { account, accountAllergy, accountRole, allergyItem } from '../db/schema.ts'

/**
 * The allergy vocabulary: readable by anyone, writable by admin.
 *
 * The property worth proving is the asymmetry. A list of foods says nothing about
 * anybody, so reading is public — but renaming an item rewrites what everybody who
 * ticked it is taken to have said, which is why writing is not the burn's-furniture
 * default the lanes and lodging use.
 */

const SECRET = 's'.repeat(40)
const NOW = '2026-07-02T00:00:00.000Z'
const LACTOSE = 'a11e0000-0000-4000-8000-000000000004'

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

const givenAccount = async (roles: ('admin' | 'member')[] = ['member']) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return { id, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
}

const list = (server: FastifyInstance) => server.inject({ method: 'GET', url: '/api/allergy-items' })

const add = (server: FastifyInstance, cookie: string, label: string) =>
  server.inject({
    method: 'POST',
    url: '/api/admin/allergy-items',
    headers: { cookie },
    payload: { label },
  })

const rename = (server: FastifyInstance, cookie: string, id: string, label: string) =>
  server.inject({
    method: 'PATCH',
    url: `/api/admin/allergy-items/${id}`,
    headers: { cookie },
    payload: { label },
  })

const remove = (server: FastifyInstance, cookie: string, id: string) =>
  server.inject({ method: 'DELETE', url: `/api/admin/allergy-items/${id}`, headers: { cookie } })

const reorder = (server: FastifyInstance, cookie: string, ids: string[]) =>
  server.inject({
    method: 'PUT',
    url: '/api/admin/allergy-items/order',
    headers: { cookie },
    payload: { ids },
  })

describe('reading the list', () => {
  it('answers anybody, signed in or not', async () => {
    // A vocabulary of foods, carrying nothing about a person — and the invite form
    // needs it before the account exists.
    const server = await build()

    expect((await list(server)).statusCode).toBe(200)
  })

  it('starts from the five the migration seeds, in order', async () => {
    const server = await build()

    const labels = (await list(server)).json().items.map((item: { label: string }) => item.label)

    expect(labels).toEqual([
      'Vegan',
      'Gluten (non-celiac)',
      'Strict gluten (celiac)',
      'Lactose',
      'Milk protein',
    ])
  })
})

describe('writing the list', () => {
  it('refuses a member who is not admin', async () => {
    // Not the burn's-furniture default: renaming an item rewrites what everybody who
    // ticked it is taken to have said.
    const server = await build()
    const member = await givenAccount(['member'])

    expect((await add(server, member.cookie, 'Nuts')).statusCode).toBe(403)
  })

  it('refuses somebody signed out', async () => {
    const server = await build()

    expect(
      (await server.inject({ method: 'POST', url: '/api/admin/allergy-items', payload: { label: 'Nuts' } }))
        .statusCode,
    ).toBe(401)
  })

  it('adds one at the end of the list', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])

    const made = await add(server, admin.cookie, 'Nuts')

    expect(made.statusCode).toBe(201)
    expect(made.json().item.order).toBe(5)
  })

  it('refuses a blank label', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])

    expect((await add(server, admin.cookie, '   ')).statusCode).toBe(400)
  })

  it('renames one, which is what a wrong label wants', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])

    const back = await rename(server, admin.cookie, LACTOSE, 'Lactose intolerance')

    expect(back.statusCode).toBe(200)
    expect(back.json().item.label).toBe('Lactose intolerance')
  })

  it('reorders the whole list', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const ids = (await list(server)).json().items.map((item: { id: string }) => item.id)

    const back = await reorder(server, admin.cookie, [...ids].reverse())

    expect(back.statusCode).toBe(200)
    expect(back.json().items.map((item: { label: string }) => item.label)[0]).toBe('Milk protein')
  })

  it('refuses a partial ordering, which would leave the rest on stale positions', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const ids = (await list(server)).json().items.map((item: { id: string }) => item.id)

    expect((await reorder(server, admin.cookie, ids.slice(0, 2))).statusCode).toBe(400)
  })
})

describe('removing an item', () => {
  it('refuses while somebody has ticked it', async () => {
    // These rows exist to keep people safe. A label going must not take a person's
    // record with it — `place` refuses the same way when a dream stands in it.
    const server = await build()
    const admin = await givenAccount(['admin'])
    const ada = await givenAccount(['member'])
    await db().insert(accountAllergy).values({ account_id: ada.id, item_id: LACTOSE })

    expect((await remove(server, admin.cookie, LACTOSE)).statusCode).toBe(409)
    expect(await db().select().from(allergyItem).where(eq(allergyItem.id, LACTOSE))).toHaveLength(1)
  })

  it('removes one nobody has ticked', async () => {
    // The passing sibling: refusing every deletion would satisfy the test above.
    const server = await build()
    const admin = await givenAccount(['admin'])

    expect((await remove(server, admin.cookie, LACTOSE)).statusCode).toBe(204)
    expect(await db().select().from(allergyItem).where(eq(allergyItem.id, LACTOSE))).toHaveLength(0)
  })

  it('answers 404 for one that is not there', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])

    expect((await remove(server, admin.cookie, randomUUID())).statusCode).toBe(404)
  })
})
