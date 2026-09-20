import type { SpecialBuy, Thread } from '@sage-burner/shared'
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
import { account, accountRole, event, meal, mealIngredient, mealSlot, pantryItem } from '../db/schema.ts'

const SECRET = 's'.repeat(40)
const NOW = '2026-07-02T00:00:00.000Z'
const BURN = '9f1c2f2a-6f1a-4a2e-9c6d-2f0a1b3c4d5e'
const ENDED = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d'

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

const givenAccount = async (roles: ('admin' | 'member')[], name: string) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, name, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })

  return { id, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
}

const givenBurn = async (id: string = BURN, name = 'Autumn burn', year = '2026') => {
  await db()
    .insert(event)
    .values({
      id,
      name,
      slug: `burn-${id.slice(0, 4)}`,
      start_date: `${year}-08-01`,
      end_date: `${year}-08-03`,
      start_time: '00:00',
      end_time: '23:59',
      member_cap: 42,
      created_at: NOW,
    })

  return id
}

const givenSitting = async (over: { eventId?: string; date?: string; label?: string } = {}) => {
  const id = randomUUID()
  const eventId = over.eventId ?? BURN
  const label = over.label ?? 'Dinner'
  await db()
    .insert(mealSlot)
    .values({ id: randomUUID(), event_id: eventId, order: 0, label, at: '18:00', kind: 'meal' })
  await db()
    .insert(meal)
    .values({
      id,
      event_id: eventId,
      date: over.date ?? '2026-08-01',
      at: '18:00',
      label,
      kind: 'meal',
      food_idea: '',
    })

  return id
}

const givenThing = async (name: string, unit: string, over: { withdrawn?: boolean } = {}) => {
  const id = randomUUID()
  await db()
    .insert(pantryItem)
    .values({
      id,
      kind: 'staple',
      name,
      unit,
      withdrawn_at: over.withdrawn === true ? NOW : null,
      created_at: NOW,
    })

  return id
}

const givenWritten = async (
  mealId: string,
  written: { name: string; unit: string; amount?: number | null; bought_at?: string },
) => {
  const id = randomUUID()
  await db()
    .insert(mealIngredient)
    .values({
      id,
      meal_id: mealId,
      pantry_item_id: null,
      name: written.name,
      unit: written.unit,
      amount: written.amount ?? null,
      bought_at: written.bought_at ?? null,
      created_at: NOW,
    })

  return id
}

const lineFrom = async (id: string) => {
  const [row] = await db().select().from(mealIngredient).where(eq(mealIngredient.id, id)).limit(1)
  if (row === undefined) throw new Error('no such line')

  return row
}

const read = (server: FastifyInstance, cookie?: string) =>
  server.inject({
    method: 'GET',
    url: '/api/admin/special-buys',
    headers: cookie === undefined ? {} : { cookie },
  })

const adopt = (
  server: FastifyInstance,
  cookie: string | undefined,
  itemId: string,
  payload: Record<string, unknown>,
) =>
  server.inject({
    method: 'POST',
    url: `/api/admin/pantry/${itemId}/adopt`,
    headers: cookie === undefined ? {} : { cookie },
    payload,
  })

const addIngredient = (
  server: FastifyInstance,
  cookie: string,
  mealId: string,
  body: Record<string, unknown>,
) =>
  server.inject({
    method: 'POST',
    url: `/api/meals/${mealId}/ingredients`,
    headers: { cookie },
    payload: body,
  })

const entriesOn = async (server: FastifyInstance, cookie: string, mealId: string) => {
  const feed = await server.inject({ method: 'GET', url: '/api/feed', headers: { cookie } })
  const card = (feed.json().threads as Thread[]).find((thread) => thread.entity_id === mealId)
  if (card === undefined) return []

  const whole = await server.inject({ method: 'GET', url: `/api/threads/${card.id}`, headers: { cookie } })

  return (whole.json().thread.entries as Thread['entries']).map((entry) => [entry.kind, entry.body])
}

const setUp = async () => {
  const server = await build()
  await givenBurn()
  const bo = await givenAccount(['admin', 'member'], 'Bo')
  const ada = await givenAccount(['member'], 'Ada')

  return { server, bo, ada }
}

describe('what is written on sittings but is not in the pantry', () => {
  it('gathers two spellings of one thing into one row, counting the sittings', async () => {
    const { server, bo } = await setUp()
    const friday = await givenSitting({ date: '2026-08-01' })
    const saturday = await givenSitting({ date: '2026-08-02' })
    await givenWritten(friday, { name: 'Saffron, 1 g sachets', unit: 'pcs' })
    await givenWritten(saturday, { name: ' SAFFRON, 1 G Sachets ', unit: 'PCS' })

    const response = await read(server, bo.cookie)

    expect(response.statusCode).toBe(200)
    expect(response.json().buys).toMatchObject([
      {
        name: 'Saffron, 1 g sachets',
        unit: 'pcs',
        sittings: 2,
        sample: { meal_label: 'Dinner', date: '2026-08-01', event_name: 'Autumn burn' },
      },
    ])
  })

  it('keeps the same name in two units apart, as the shopping list does', async () => {
    const { server, bo } = await setUp()
    const friday = await givenSitting({ date: '2026-08-01' })
    await givenWritten(friday, { name: 'Saffron', unit: 'g' })
    await givenWritten(friday, { name: 'Saffron', unit: 'pcs' })

    expect((await read(server, bo.cookie)).json().buys).toHaveLength(2)
  })

  it('counts one sitting once, however many lines of it say the same thing', async () => {
    const { server, bo } = await setUp()
    const friday = await givenSitting({ date: '2026-08-01' })
    await givenWritten(friday, { name: 'Saffron', unit: 'g' })
    await givenWritten(friday, { name: 'Saffron', unit: 'g' })

    expect((await read(server, bo.cookie)).json().buys).toMatchObject([{ sittings: 1 }])
  })

  it('leaves out a pantry pick, which is already on the list', async () => {
    const { server, bo } = await setUp()
    const friday = await givenSitting({ date: '2026-08-01' })
    const lentils = await givenThing('Lentils, red', 'kg')
    await db().insert(mealIngredient).values({
      id: randomUUID(),
      meal_id: friday,
      pantry_item_id: lentils,
      name: null,
      unit: null,
      amount: 1,
      created_at: NOW,
    })

    expect((await read(server, bo.cookie)).json().buys).toEqual([])
  })

  it('leaves out a burn that has ended, and keeps one that has not', async () => {
    const { server, bo } = await setUp()
    await givenBurn(ENDED, 'Last summer', '2025')
    const over = await givenSitting({ eventId: ENDED, date: '2025-08-01' })
    const coming = await givenSitting({ date: '2026-08-01' })
    await givenWritten(over, { name: 'Rosewater', unit: 'l' })
    await givenWritten(coming, { name: 'Saffron', unit: 'g' })

    expect((await read(server, bo.cookie)).json().buys.map((buy: SpecialBuy) => buy.name)).toEqual([
      'Saffron',
    ])
  })

  it('puts what is written most often first, and settles a tie by name', async () => {
    const { server, bo } = await setUp()
    const friday = await givenSitting({ date: '2026-08-01' })
    const saturday = await givenSitting({ date: '2026-08-02' })
    await givenWritten(friday, { name: 'Saffron', unit: 'g' })
    await givenWritten(saturday, { name: 'Saffron', unit: 'g' })
    await givenWritten(friday, { name: 'Rosewater', unit: 'l' })
    await givenWritten(friday, { name: 'Anise', unit: 'g' })

    expect((await read(server, bo.cookie)).json().buys.map((buy: SpecialBuy) => buy.name)).toEqual([
      'Saffron',
      'Anise',
      'Rosewater',
    ])
  })

  it('carries every line under the key, with its amount and the sitting it is on', async () => {
    const { server, bo } = await setUp()
    const friday = await givenSitting({ date: '2026-08-01' })
    const saturday = await givenSitting({ date: '2026-08-02', label: 'Lunch' })
    const one = await givenWritten(friday, { name: 'Salsa', unit: 'jars', amount: 1 })
    const other = await givenWritten(saturday, { name: ' SALSA ', unit: 'Jars' })

    expect((await read(server, bo.cookie)).json().buys[0].lines).toEqual([
      { id: one, amount: 1, meal_label: 'Dinner', date: '2026-08-01', event_name: 'Autumn burn' },
      { id: other, amount: null, meal_label: 'Lunch', date: '2026-08-02', event_name: 'Autumn burn' },
    ])
  })

  it('leaves a line of a burn that has ended out of the lines, as it leaves it out of the count', async () => {
    const { server, bo } = await setUp()
    await givenBurn(ENDED, 'Last summer', '2025')
    const over = await givenSitting({ eventId: ENDED, date: '2025-08-01' })
    const coming = await givenSitting({ date: '2026-08-01' })
    await givenWritten(over, { name: 'Salsa', unit: 'jars' })
    const soon = await givenWritten(coming, { name: 'Salsa', unit: 'jars' })

    expect(
      (await read(server, bo.cookie)).json().buys[0].lines.map((line: { id: string }) => line.id),
    ).toEqual([soon])
  })

  it('is the admin’s to read', async () => {
    const { server, ada } = await setUp()

    expect((await read(server, ada.cookie)).statusCode).toBe(403)
    expect((await read(server)).statusCode).toBe(401)
  })
})

describe('promoting a special buy to a pantry thing', () => {
  it('points every line written that way at the thing, keeping the amount and the tick', async () => {
    const { server, bo } = await setUp()
    const friday = await givenSitting({ date: '2026-08-01' })
    const saturday = await givenSitting({ date: '2026-08-02' })
    const one = await givenWritten(friday, { name: 'Saffron, 1 g sachets', unit: 'pcs', amount: 2 })
    const other = await givenWritten(saturday, {
      name: ' saffron, 1 g SACHETS ',
      unit: 'pcs',
      amount: 3,
      bought_at: NOW,
    })
    const thing = await givenThing('Saffron, 1 g sachets', 'pcs')

    const response = await adopt(server, bo.cookie, thing, { name: 'Saffron, 1 g sachets', unit: 'pcs' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ adopted: 2 })
    expect(await lineFrom(one)).toMatchObject({ pantry_item_id: thing, name: null, unit: null, amount: 2 })
    expect(await lineFrom(other)).toMatchObject({ pantry_item_id: thing, amount: 3, bought_at: NOW })
  })

  it('leaves a line written in another unit as a special buy', async () => {
    const { server, bo } = await setUp()
    const friday = await givenSitting({ date: '2026-08-01' })
    const grams = await givenWritten(friday, { name: 'Saffron', unit: 'g' })
    const sachets = await givenWritten(friday, { name: 'Saffron', unit: 'pcs' })
    const thing = await givenThing('Saffron', 'pcs')

    const response = await adopt(server, bo.cookie, thing, { name: 'Saffron', unit: 'pcs' })

    expect(response.json()).toEqual({ adopted: 1 })
    expect((await lineFrom(sachets)).pantry_item_id).toBe(thing)
    expect(await lineFrom(grams)).toMatchObject({ pantry_item_id: null, name: 'Saffron', unit: 'g' })
  })

  it('takes the lines even when the thing is counted in another unit than they were written in', async () => {
    const { server, bo } = await setUp()
    const friday = await givenSitting({ date: '2026-08-01' })
    const written = await givenWritten(friday, { name: 'Saffron', unit: 'pcs', amount: 2 })
    const thing = await givenThing('Saffron', 'g')

    const response = await adopt(server, bo.cookie, thing, { name: 'Saffron', unit: 'pcs' })

    expect(response.json()).toEqual({ adopted: 1 })
    expect(await lineFrom(written)).toMatchObject({ pantry_item_id: thing, amount: 2 })
  })

  it('sets the amount a line was given and keeps the one it was not', async () => {
    const { server, bo } = await setUp()
    const friday = await givenSitting({ date: '2026-08-01' })
    const saturday = await givenSitting({ date: '2026-08-02' })
    const said = await givenWritten(friday, { name: 'Salsa', unit: 'jars', amount: 1 })
    const left = await givenWritten(saturday, { name: 'Salsa', unit: 'jars', amount: 3 })
    const emptied = await givenWritten(saturday, { name: 'Salsa', unit: 'jars', amount: 4 })
    const thing = await givenThing('Salsa, chunky', 'jars (300g)')

    const response = await adopt(server, bo.cookie, thing, {
      name: 'Salsa',
      unit: 'jars',
      amounts: { [said]: 2.5, [emptied]: null },
    })

    expect(response.json()).toEqual({ adopted: 3 })
    expect(await lineFrom(said)).toMatchObject({ pantry_item_id: thing, amount: 2.5 })
    expect(await lineFrom(left)).toMatchObject({ pantry_item_id: thing, amount: 3 })
    expect(await lineFrom(emptied)).toMatchObject({ pantry_item_id: thing, amount: null })
  })

  it('refuses an amount for a line it is not converting, and writes nothing at all', async () => {
    const { server, bo } = await setUp()
    const friday = await givenSitting({ date: '2026-08-01' })
    const mine = await givenWritten(friday, { name: 'Salsa', unit: 'jars', amount: 1 })
    const other = await givenWritten(friday, { name: 'Rosewater', unit: 'l', amount: 1 })
    const thing = await givenThing('Salsa', 'jars (300g)')

    const response = await adopt(server, bo.cookie, thing, {
      name: 'Salsa',
      unit: 'jars',
      amounts: { [other]: 2 },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'bad_request' })
    expect((await lineFrom(mine)).pantry_item_id).toBeNull()
    expect(await lineFrom(other)).toMatchObject({ pantry_item_id: null, amount: 1 })
  })

  it('drops an amount for a line nobody has any more, and takes the rest', async () => {
    const { server, bo } = await setUp()
    const friday = await givenSitting({ date: '2026-08-01' })
    const mine = await givenWritten(friday, { name: 'Salsa', unit: 'jars', amount: 1 })
    const thing = await givenThing('Salsa', 'jars (300g)')

    const response = await adopt(server, bo.cookie, thing, {
      name: 'Salsa',
      unit: 'jars',
      amounts: { [mine]: 2, [randomUUID()]: 5 },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ adopted: 1 })
    expect(await lineFrom(mine)).toMatchObject({ pantry_item_id: thing, amount: 2 })
  })

  it('leaves a line already pointed at another thing alone and takes its sibling', async () => {
    const { server, bo } = await setUp()
    const friday = await givenSitting({ date: '2026-08-01' })
    const mine = await givenWritten(friday, { name: 'Salsa', unit: 'jars', amount: 1 })
    const spoken = await givenThing('Salsa, mild', 'jars')
    const taken = await givenWritten(friday, { name: 'Salsa', unit: 'jars', amount: 4 })
    await db()
      .update(mealIngredient)
      .set({ pantry_item_id: spoken, name: null, unit: null })
      .where(eq(mealIngredient.id, taken))
    const thing = await givenThing('Salsa, chunky', 'jars (300g)')

    const response = await adopt(server, bo.cookie, thing, { name: 'Salsa', unit: 'jars' })

    expect(response.json()).toEqual({ adopted: 1 })
    expect((await lineFrom(mine)).pantry_item_id).toBe(thing)
    expect(await lineFrom(taken)).toMatchObject({ pantry_item_id: spoken, amount: 4 })
  })

  it('refuses an amount for a line on a burn that has ended', async () => {
    const { server, bo } = await setUp()
    await givenBurn(ENDED, 'Last summer', '2025')
    const over = await givenSitting({ eventId: ENDED, date: '2025-08-01' })
    const old = await givenWritten(over, { name: 'Salsa', unit: 'jars', amount: 1 })
    const thing = await givenThing('Salsa', 'jars (300g)')

    const response = await adopt(server, bo.cookie, thing, {
      name: 'Salsa',
      unit: 'jars',
      amounts: { [old]: 2 },
    })

    expect(response.statusCode).toBe(400)
    expect(await lineFrom(old)).toMatchObject({ pantry_item_id: null, amount: 1 })
  })

  it('leaves a burn that has ended as it was written', async () => {
    const { server, bo } = await setUp()
    await givenBurn(ENDED, 'Last summer', '2025')
    const over = await givenSitting({ eventId: ENDED, date: '2025-08-01' })
    const coming = await givenSitting({ date: '2026-08-01' })
    const old = await givenWritten(over, { name: 'Saffron', unit: 'pcs' })
    const soon = await givenWritten(coming, { name: 'Saffron', unit: 'pcs' })
    const thing = await givenThing('Saffron', 'pcs')

    const response = await adopt(server, bo.cookie, thing, { name: 'Saffron', unit: 'pcs' })

    expect(response.json()).toEqual({ adopted: 1 })
    expect((await lineFrom(soon)).pantry_item_id).toBe(thing)
    expect(await lineFrom(old)).toMatchObject({ pantry_item_id: null, name: 'Saffron' })
  })

  it('says on every sitting it touched that what it needs has changed', async () => {
    const { server, bo, ada } = await setUp()
    const friday = await givenSitting({ date: '2026-08-01' })
    const saturday = await givenSitting({ date: '2026-08-02' })
    await addIngredient(server, ada.cookie, friday, { name: 'Saffron', unit: 'pcs', amount: 1 })
    await addIngredient(server, ada.cookie, saturday, { name: 'Saffron', unit: 'pcs', amount: 1 })
    const thing = await givenThing('Saffron', 'pcs')

    await adopt(server, bo.cookie, thing, { name: 'Saffron', unit: 'pcs' })

    expect(await entriesOn(server, bo.cookie, friday)).toEqual([
      ['edited', 'changed what it needs'],
      ['edited', 'changed what it needs'],
    ])
    expect(await entriesOn(server, bo.cookie, saturday)).toEqual([
      ['edited', 'changed what it needs'],
      ['edited', 'changed what it needs'],
    ])
  })

  it('coalesces into the entry the same admin’s last edit left', async () => {
    const { server, bo } = await setUp()
    const friday = await givenSitting({ date: '2026-08-01' })
    await addIngredient(server, bo.cookie, friday, { name: 'Saffron', unit: 'pcs', amount: 1 })
    const thing = await givenThing('Saffron', 'pcs')

    await adopt(server, bo.cookie, thing, { name: 'Saffron', unit: 'pcs' })

    expect(await entriesOn(server, bo.cookie, friday)).toEqual([['edited', 'changed what it needs']])
  })

  it('says nothing on a sitting it did not touch', async () => {
    const { server, bo } = await setUp()
    const friday = await givenSitting({ date: '2026-08-01' })
    await givenWritten(friday, { name: 'Rosewater', unit: 'l' })
    const thing = await givenThing('Saffron', 'pcs')

    await adopt(server, bo.cookie, thing, { name: 'Saffron', unit: 'pcs' })

    expect(await entriesOn(server, bo.cookie, friday)).toEqual([])
  })

  it('is a 404 on a thing that has been taken off the list', async () => {
    const { server, bo } = await setUp()
    const friday = await givenSitting({ date: '2026-08-01' })
    const written = await givenWritten(friday, { name: 'Saffron', unit: 'pcs' })
    const gone = await givenThing('Saffron', 'pcs', { withdrawn: true })

    expect((await adopt(server, bo.cookie, gone, { name: 'Saffron', unit: 'pcs' })).statusCode).toBe(404)
    expect((await lineFrom(written)).pantry_item_id).toBeNull()
  })

  it('is a 404 on a thing nobody has', async () => {
    const { server, bo } = await setUp()

    expect((await adopt(server, bo.cookie, randomUUID(), { name: 'Saffron', unit: 'pcs' })).statusCode).toBe(
      404,
    )
  })

  it('refuses a body that names no unit', async () => {
    const { server, bo } = await setUp()
    const thing = await givenThing('Saffron', 'pcs')

    expect((await adopt(server, bo.cookie, thing, { name: 'Saffron' })).statusCode).toBe(400)
  })

  it('is the admin’s to press', async () => {
    const { server, ada } = await setUp()
    const friday = await givenSitting({ date: '2026-08-01' })
    const written = await givenWritten(friday, { name: 'Saffron', unit: 'pcs' })
    const thing = await givenThing('Saffron', 'pcs')

    expect((await adopt(server, ada.cookie, thing, { name: 'Saffron', unit: 'pcs' })).statusCode).toBe(403)
    expect((await adopt(server, undefined, thing, { name: 'Saffron', unit: 'pcs' })).statusCode).toBe(401)
    expect((await lineFrom(written)).pantry_item_id).toBeNull()
  })
})
