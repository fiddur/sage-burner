import type { EventPantryItem } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, attendance, event } from '../db/schema.ts'

const SECRET = 'p'.repeat(40)
const NOW = '2026-07-02T10:00:00.000Z'
const BURN = 'e0000000-0000-4000-8000-000000000001'
const OVER = 'e0000000-0000-4000-8000-000000000002'

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

const givenAccount = async (name: null | string, roles: ('admin' | 'member')[] = ['member']) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, name, password_hash: null, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })

  return { id, name, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
}

const givenBurn = async (
  id = BURN,
  { start_date = '2026-08-01', end_date = '2026-08-03', slug = 'summer' } = {},
) => {
  await db()
    .insert(event)
    .values({ id, name: 'Summer burn', slug, start_date, end_date, member_cap: 20, created_at: NOW })
}

const givenComing = async (accountId: string, eventId = BURN) => {
  const id = randomUUID()
  await db().insert(attendance).values({ id, event_id: eventId, account_id: accountId, joined_at: NOW })

  return id
}

const list = async (server: FastifyInstance, cookie: string, eventId = BURN): Promise<EventPantryItem[]> =>
  (await server.inject({ method: 'GET', url: `/api/events/${eventId}/pantry`, headers: { cookie } })).json()
    .items

const oneOf = async (server: FastifyInstance, cookie: string, name: string, eventId = BURN) => {
  const found = (await list(server, cookie, eventId)).find((item) => item.name === name)
  if (found === undefined) throw new Error(`no ${name} in the pantry`)

  return found
}

const heart = (server: FastifyInstance, cookie: string, itemId: string, eventId = BURN) =>
  server.inject({
    method: 'PUT',
    url: `/api/events/${eventId}/pantry/${itemId}/heart`,
    headers: { cookie },
  })

const unheart = (server: FastifyInstance, cookie: string, itemId: string, eventId = BURN) =>
  server.inject({
    method: 'DELETE',
    url: `/api/events/${eventId}/pantry/${itemId}/heart`,
    headers: { cookie },
  })

const tick = (server: FastifyInstance, cookie: string, itemId: string, eventId = BURN) =>
  server.inject({
    method: 'PUT',
    url: `/api/events/${eventId}/pantry/${itemId}/bought`,
    headers: { cookie },
  })

const untick = (server: FastifyInstance, cookie: string, itemId: string, eventId = BURN) =>
  server.inject({
    method: 'DELETE',
    url: `/api/events/${eventId}/pantry/${itemId}/bought`,
    headers: { cookie },
  })

const withdraw = (server: FastifyInstance, cookie: string, itemId: string) =>
  server.inject({ method: 'DELETE', url: `/api/admin/pantry/${itemId}`, headers: { cookie } })

describe('the pantry as one burn sees it', () => {
  it('answers every live thing with its hearts and its tick in one read', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)

    const oatmeal = await oneOf(server, ada.cookie, 'Oatmeal')
    await heart(server, ada.cookie, oatmeal.id)
    await tick(server, ada.cookie, oatmeal.id)

    const answered = await oneOf(server, ada.cookie, 'Oatmeal')

    expect(answered.hearts).toEqual({
      count: 1,
      people: [{ account_id: ada.id, name: 'Ada', avatar: null }],
      mine: true,
    })
    expect(answered.bought).toEqual({ by: ada.id, by_name: 'Ada', at: NOW })
  })

  it('needs no attendance to read', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')

    const answered = await server.inject({
      method: 'GET',
      url: `/api/events/${BURN}/pantry`,
      headers: { cookie: ada.cookie },
    })

    expect(answered.statusCode).toBe(200)
    expect((await list(server, ada.cookie)).length).toBeGreaterThan(0)
  })

  it('refuses a stranger', async () => {
    const server = await build()
    await givenBurn()

    expect((await server.inject({ method: 'GET', url: `/api/events/${BURN}/pantry` })).statusCode).toBe(401)
  })

  it('says a heart is not yours when it is somebody else’s', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bo = await givenAccount('Bo')
    await givenComing(ada.id)
    await givenComing(bo.id)

    const oatmeal = await oneOf(server, ada.cookie, 'Oatmeal')
    await heart(server, bo.cookie, oatmeal.id)

    const seen = await oneOf(server, ada.cookie, 'Oatmeal')

    expect(seen.hearts.count).toBe(1)
    expect(seen.hearts.mine).toBe(false)
  })

  it('counts only the hearts given at this burn', async () => {
    const server = await build()
    await givenBurn()
    await givenBurn(OVER, { start_date: '2026-09-01', end_date: '2026-09-03', slug: 'autumn' })
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    await givenComing(ada.id, OVER)

    const oatmeal = await oneOf(server, ada.cookie, 'Oatmeal')
    await heart(server, ada.cookie, oatmeal.id, OVER)

    expect((await oneOf(server, ada.cookie, 'Oatmeal')).hearts.count).toBe(0)
    expect((await oneOf(server, ada.cookie, 'Oatmeal', OVER)).hearts.count).toBe(1)
  })

  it('leaves out a thing taken off the list, hearted or not', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada', ['admin', 'member'])
    await givenComing(ada.id)

    const oatmeal = await oneOf(server, ada.cookie, 'Oatmeal')
    await heart(server, ada.cookie, oatmeal.id)
    await withdraw(server, ada.cookie, oatmeal.id)

    expect((await list(server, ada.cookie)).some((item) => item.name === 'Oatmeal')).toBe(false)
  })
})

describe('hearting what you want there', () => {
  it('is any approved member’s who has joined the burn', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)

    const oatmeal = await oneOf(server, ada.cookie, 'Oatmeal')

    expect((await heart(server, ada.cookie, oatmeal.id)).statusCode).toBe(204)
    expect((await oneOf(server, ada.cookie, 'Oatmeal')).hearts.mine).toBe(true)
  })

  it('tells somebody who has not joined to join first', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')

    const oatmeal = await oneOf(server, ada.cookie, 'Oatmeal')
    const refused = await heart(server, ada.cookie, oatmeal.id)

    expect(refused.statusCode).toBe(400)
    expect(refused.json().error).toBe('not_attending')
  })

  it('is refused on a burn that has ended', async () => {
    const server = await build()
    await givenBurn(OVER, { start_date: '2026-06-01', end_date: '2026-06-03', slug: 'spring' })
    const ada = await givenAccount('Ada')
    await givenComing(ada.id, OVER)

    const oatmeal = await oneOf(server, ada.cookie, 'Oatmeal', OVER)

    expect((await heart(server, ada.cookie, oatmeal.id, OVER)).statusCode).toBe(404)
  })

  it('is refused on a thing that is not on the list any more', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada', ['admin', 'member'])
    await givenComing(ada.id)

    const oatmeal = await oneOf(server, ada.cookie, 'Oatmeal')
    await withdraw(server, ada.cookie, oatmeal.id)

    expect((await heart(server, ada.cookie, oatmeal.id)).statusCode).toBe(404)
  })

  it('counts one heart however many times it is pressed', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)

    const oatmeal = await oneOf(server, ada.cookie, 'Oatmeal')
    await heart(server, ada.cookie, oatmeal.id)
    const again = await heart(server, ada.cookie, oatmeal.id)

    expect(again.statusCode).toBe(204)
    expect((await oneOf(server, ada.cookie, 'Oatmeal')).hearts.count).toBe(1)
  })

  it('takes back only your own, and says nothing when there was none', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bo = await givenAccount('Bo')
    await givenComing(ada.id)
    await givenComing(bo.id)

    const oatmeal = await oneOf(server, ada.cookie, 'Oatmeal')
    await heart(server, ada.cookie, oatmeal.id)
    await heart(server, bo.cookie, oatmeal.id)

    expect((await unheart(server, ada.cookie, oatmeal.id)).statusCode).toBe(204)
    expect((await unheart(server, ada.cookie, oatmeal.id)).statusCode).toBe(204)

    const left = await oneOf(server, bo.cookie, 'Oatmeal')
    expect(left.hearts.count).toBe(1)
    expect(left.hearts.mine).toBe(true)
  })

  it('goes with the attendance, so leaving the burn withdraws it', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const stay = await givenComing(ada.id)

    const oatmeal = await oneOf(server, ada.cookie, 'Oatmeal')
    await heart(server, ada.cookie, oatmeal.id)

    client().prepare('delete from attendance where id = ?').run(stay)

    expect((await oneOf(server, ada.cookie, 'Oatmeal')).hearts.count).toBe(0)
  })

  it('names an account nobody has named yet by its id, not by nothing', async () => {
    const server = await build()
    await givenBurn()
    const nameless = await givenAccount(null)
    await givenComing(nameless.id)

    const oatmeal = await oneOf(server, nameless.cookie, 'Oatmeal')
    await heart(server, nameless.cookie, oatmeal.id)

    expect((await oneOf(server, nameless.cookie, 'Oatmeal')).hearts.people).toEqual([
      { account_id: nameless.id, name: null, avatar: null },
    ])
  })
})

describe('ticking something off in the shop', () => {
  it('records who bought it and when, without their having joined the burn', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')

    const oatmeal = await oneOf(server, ada.cookie, 'Oatmeal')

    expect((await tick(server, ada.cookie, oatmeal.id)).statusCode).toBe(204)
    expect((await oneOf(server, ada.cookie, 'Oatmeal')).bought).toEqual({
      by: ada.id,
      by_name: 'Ada',
      at: NOW,
    })
  })

  it('keeps the first buyer when a second tick lands on it', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bo = await givenAccount('Bo')

    const oatmeal = await oneOf(server, ada.cookie, 'Oatmeal')
    await tick(server, ada.cookie, oatmeal.id)
    await tick(server, bo.cookie, oatmeal.id)

    expect((await oneOf(server, ada.cookie, 'Oatmeal')).bought?.by_name).toBe('Ada')
  })

  it('unticks to nothing, twice over', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')

    const oatmeal = await oneOf(server, ada.cookie, 'Oatmeal')
    await tick(server, ada.cookie, oatmeal.id)

    expect((await untick(server, ada.cookie, oatmeal.id)).statusCode).toBe(204)
    expect((await untick(server, ada.cookie, oatmeal.id)).statusCode).toBe(204)
    expect((await oneOf(server, ada.cookie, 'Oatmeal')).bought).toBeNull()
  })

  it('is one tick per burn, so the next one starts unbought', async () => {
    const server = await build()
    await givenBurn()
    await givenBurn(OVER, { start_date: '2026-09-01', end_date: '2026-09-03', slug: 'autumn' })
    const ada = await givenAccount('Ada')

    const oatmeal = await oneOf(server, ada.cookie, 'Oatmeal')
    await tick(server, ada.cookie, oatmeal.id)

    expect((await oneOf(server, ada.cookie, 'Oatmeal', OVER)).bought).toBeNull()
  })

  it('is refused on a burn that has ended', async () => {
    const server = await build()
    await givenBurn(OVER, { start_date: '2026-06-01', end_date: '2026-06-03', slug: 'spring' })
    const ada = await givenAccount('Ada')

    const oatmeal = await oneOf(server, ada.cookie, 'Oatmeal', OVER)

    expect((await tick(server, ada.cookie, oatmeal.id, OVER)).statusCode).toBe(404)
  })
})

describe('the rows behind all that', () => {
  it('takes one heart per person per thing', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const stay = await givenComing(ada.id)
    const oatmeal = await oneOf(server, ada.cookie, 'Oatmeal')

    client().prepare('insert into pantry_heart (item_id, attendance_id) values (?, ?)').run(oatmeal.id, stay)

    expect(() =>
      client()
        .prepare('insert into pantry_heart (item_id, attendance_id) values (?, ?)')
        .run(oatmeal.id, stay),
    ).toThrow()
  })

  it('drops a heart with the thing it is on', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const stay = await givenComing(ada.id)
    const oatmeal = await oneOf(server, ada.cookie, 'Oatmeal')

    client().prepare('insert into pantry_heart (item_id, attendance_id) values (?, ?)').run(oatmeal.id, stay)
    client().prepare('delete from pantry_item where id = ?').run(oatmeal.id)

    expect(client().prepare('select count(*) as n from pantry_heart').get()?.n).toBe(0)
  })

  it('takes one purchase per burn and thing, and drops it with the burn', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const oatmeal = await oneOf(server, ada.cookie, 'Oatmeal')

    const put = client().prepare(
      'insert into pantry_purchase (event_id, item_id, bought_by, bought_at) values (?, ?, ?, ?)',
    )
    put.run(BURN, oatmeal.id, ada.id, NOW)

    expect(() => put.run(BURN, oatmeal.id, ada.id, NOW)).toThrow()

    client().prepare('delete from event where id = ?').run(BURN)

    expect(client().prepare('select count(*) as n from pantry_purchase').get()?.n).toBe(0)
  })

  it('keeps what was bought when the buyer’s account goes', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const oatmeal = await oneOf(server, ada.cookie, 'Oatmeal')
    await tick(server, ada.cookie, oatmeal.id)

    client().prepare('delete from account_role where account_id = ?').run(ada.id)
    client().prepare('delete from account where id = ?').run(ada.id)

    const left = client()
      .prepare('select bought_by, bought_at from pantry_purchase where item_id = ?')
      .get(oatmeal.id)

    expect(left?.bought_by).toBeNull()
    expect(left?.bought_at).toBe(NOW)
  })
})

describe("what the burn's pantry says a thing contains", () => {
  it('carries the tags, which is what the sitting warns from', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada', ['admin', 'member'])
    const oatmeal = await oneOf(server, ada.cookie, 'Oatmeal')

    await server.inject({
      method: 'PATCH',
      url: `/api/admin/pantry/${oatmeal.id}`,
      headers: { cookie: ada.cookie },
      payload: { allergy_item_ids: ['a11e0000-0000-4000-8000-000000000002'] },
    })

    const again = await oneOf(server, ada.cookie, 'Oatmeal')

    expect(again.allergies).toEqual([
      { id: 'a11e0000-0000-4000-8000-000000000002', label: 'Gluten (non-celiac)' },
    ])
  })
})
