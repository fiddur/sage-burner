import type { Meal, Thread } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, attendance, event, meal, mealSlot, pantryItem } from '../db/schema.ts'
import { sendGuarded } from '../if-match.testing.ts'

const SECRET = 'i'.repeat(40)
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

const givenAccount = async (roles: ('admin' | 'member')[], name: string | null = null) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, name, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })

  return { id, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
}

const givenBurn = async (id: string = BURN, year = '2026') => {
  await db()
    .insert(event)
    .values({
      id,
      name: `Burn ${id.slice(0, 4)}`,
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

const givenAttending = async (name: string | null = null, eventId: string = BURN) => {
  const who = await givenAccount(['member'], name)
  await db().insert(attendance).values({
    id: randomUUID(),
    event_id: eventId,
    account_id: who.id,
    joined_at: NOW,
    payment_status: 'unpaid',
  })

  return who
}

const givenSitting = async (eventId: string = BURN, date = '2026-08-01') => {
  const id = randomUUID()
  await db()
    .insert(mealSlot)
    .values({ id: randomUUID(), event_id: eventId, order: 0, label: 'Dinner', at: '18:00', kind: 'meal' })
  await db()
    .insert(meal)
    .values({ id, event_id: eventId, date, at: '18:00', label: 'Dinner', kind: 'meal', food_idea: '' })

  return id
}

const givenPantryItem = async (name: string, over: { unit?: string; withdrawn_at?: string } = {}) => {
  const id = randomUUID()
  await db()
    .insert(pantryItem)
    .values({
      id,
      kind: 'staple',
      name,
      unit: over.unit ?? 'kg',
      where: 'Hallway bucket',
      withdrawn_at: over.withdrawn_at ?? null,
      created_at: NOW,
    })

  return id
}

const send = (
  server: FastifyInstance,
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT',
  url: string,
  cookie: string | undefined,
  payload?: Record<string, unknown>,
) =>
  sendGuarded((extra) =>
    server.inject({
      method,
      url,
      headers: { ...(cookie === undefined ? {} : { cookie }), ...extra },
      ...(payload && { payload }),
    }),
  )

const add = (server: FastifyInstance, cookie: string, mealId: string, body: Record<string, unknown>) =>
  send(server, 'POST', `/api/meals/${mealId}/ingredients`, cookie, body)

const sittingFrom = async (server: FastifyInstance, cookie: string, mealId: string): Promise<Meal> => {
  const plan = (await send(server, 'GET', `/api/events/${BURN}/meals`, cookie)).json()
  const found = (plan.meals as Meal[]).find((sitting) => sitting.id === mealId)
  if (found === undefined) throw new Error('no such sitting')

  return found
}

const entriesOn = async (server: FastifyInstance, cookie: string, mealId: string) => {
  const feed = await send(server, 'GET', '/api/feed', cookie)
  const card = (feed.json().threads as Thread[]).find((thread) => thread.entity_id === mealId)
  if (card === undefined) return []

  const whole = await send(server, 'GET', `/api/threads/${card.id}`, cookie)

  return (whole.json().thread.entries as Thread['entries']).map((entry) => [entry.kind, entry.body])
}

const setUp = async () => {
  const server = await build()
  await givenBurn()
  const ada = await givenAttending('Ada')
  const mealId = await givenSitting()

  return { server, ada, mealId }
}

describe('how many a sitting feeds', () => {
  it('starts at one, and is changed through the sitting itself', async () => {
    const { server, ada, mealId } = await setUp()

    expect((await sittingFrom(server, ada.cookie, mealId)).serves).toBe(1)

    const response = await send(server, 'PATCH', `/api/meals/${mealId}`, ada.cookie, { serves: 10 })

    expect(response.statusCode).toBe(200)
    expect(response.json().meal.serves).toBe(10)
  })

  it('refuses a number that feeds nobody', async () => {
    const { server, ada, mealId } = await setUp()

    expect((await send(server, 'PATCH', `/api/meals/${mealId}`, ada.cookie, { serves: 0 })).statusCode).toBe(
      400,
    )
  })
})

describe('the ingredients of a sitting', () => {
  it('takes a pantry pick, and resolves its name, unit and place from the pantry', async () => {
    const { server, ada, mealId } = await setUp()
    const lentils = await givenPantryItem('Lentils, red')

    const response = await add(server, ada.cookie, mealId, { pantry_item_id: lentils, amount: 1 })

    expect(response.statusCode).toBe(201)
    expect(response.json().meal.ingredients).toMatchObject([
      {
        pantry_item_id: lentils,
        name: 'Lentils, red',
        unit: 'kg',
        amount: 1,
        bought: null,
        pantry: { where: 'Hallway bucket', stock_level: null },
      },
    ])
  })

  it('takes a special buy as the cook wrote it', async () => {
    const { server, ada, mealId } = await setUp()

    const response = await add(server, ada.cookie, mealId, {
      name: 'Saffron, 1 g sachets',
      unit: 'pcs',
      amount: 2,
    })

    expect(response.json().meal.ingredients).toMatchObject([
      { pantry_item_id: null, name: 'Saffron, 1 g sachets', unit: 'pcs', amount: 2, pantry: null },
    ])
  })

  it('takes a line with no amount, which is what “to taste” is', async () => {
    const { server, ada, mealId } = await setUp()
    const salt = await givenPantryItem('Salt')

    const response = await add(server, ada.cookie, mealId, { pantry_item_id: salt })

    expect(response.statusCode).toBe(201)
    expect(response.json().meal.ingredients[0].amount).toBeNull()
  })

  it('refuses a pick that has been taken off the pantry list', async () => {
    const { server, ada, mealId } = await setUp()
    const gone = await givenPantryItem('Lentils, red', { withdrawn_at: NOW })

    expect((await add(server, ada.cookie, mealId, { pantry_item_id: gone, amount: 1 })).statusCode).toBe(400)
  })

  it('refuses a pick that is not on the list at all', async () => {
    const { server, ada, mealId } = await setUp()

    expect((await add(server, ada.cookie, mealId, { pantry_item_id: randomUUID() })).statusCode).toBe(400)
  })

  it('refuses a line that is both a pick and a name of its own', async () => {
    const { server, ada, mealId } = await setUp()
    const lentils = await givenPantryItem('Lentils, red')

    expect(
      (await add(server, ada.cookie, mealId, { pantry_item_id: lentils, name: 'Lentils', unit: 'kg' }))
        .statusCode,
    ).toBe(400)
  })

  it('keeps them in the order they were written, two in the same second included', async () => {
    const { server, ada, mealId } = await setUp()
    const lentils = await givenPantryItem('Lentils, red')

    await add(server, ada.cookie, mealId, { pantry_item_id: lentils, amount: 1 })
    await add(server, ada.cookie, mealId, { name: 'Saffron', unit: 'pcs', amount: 2 })

    const { ingredients } = await sittingFrom(server, ada.cookie, mealId)

    expect(ingredients.map((line) => line.name)).toEqual(['Lentils, red', 'Saffron'])
  })

  it('changes the amount of a line', async () => {
    const { server, ada, mealId } = await setUp()
    const lentils = await givenPantryItem('Lentils, red')
    const added = (await add(server, ada.cookie, mealId, { pantry_item_id: lentils, amount: 1 })).json()

    const response = await send(
      server,
      'PATCH',
      `/api/meal-ingredients/${added.meal.ingredients[0].id}`,
      ada.cookie,
      { amount: 2.5 },
    )

    expect(response.statusCode).toBe(200)
    expect(response.json().meal.ingredients[0].amount).toBe(2.5)
  })

  it('rewrites a special buy, and refuses to rename a pick', async () => {
    const { server, ada, mealId } = await setUp()
    const lentils = await givenPantryItem('Lentils, red')
    const pick = (await add(server, ada.cookie, mealId, { pantry_item_id: lentils, amount: 1 })).json()
    const special = (await add(server, ada.cookie, mealId, { name: 'Saffron', unit: 'pcs' })).json()

    const written = await send(
      server,
      'PATCH',
      `/api/meal-ingredients/${special.meal.ingredients[1].id}`,
      ada.cookie,
      { name: 'Saffron, 1 g sachets' },
    )
    const renamed = await send(
      server,
      'PATCH',
      `/api/meal-ingredients/${pick.meal.ingredients[0].id}`,
      ada.cookie,
      { name: 'Lentils' },
    )

    expect(written.statusCode).toBe(200)
    expect(written.json().meal.ingredients[1].name).toBe('Saffron, 1 g sachets')
    expect(renamed.statusCode).toBe(400)
  })

  it('refuses a patch that changes nothing', async () => {
    const { server, ada, mealId } = await setUp()
    const added = (await add(server, ada.cookie, mealId, { name: 'Saffron', unit: 'pcs' })).json()

    expect(
      (await send(server, 'PATCH', `/api/meal-ingredients/${added.meal.ingredients[0].id}`, ada.cookie, {}))
        .statusCode,
    ).toBe(400)
  })

  it('takes a line off again', async () => {
    const { server, ada, mealId } = await setUp()
    const added = (await add(server, ada.cookie, mealId, { name: 'Saffron', unit: 'pcs' })).json()

    const response = await send(
      server,
      'DELETE',
      `/api/meal-ingredients/${added.meal.ingredients[0].id}`,
      ada.cookie,
    )

    expect(response.statusCode).toBe(204)
    expect((await sittingFrom(server, ada.cookie, mealId)).ingredients).toEqual([])
  })

  it('goes with the sitting when the sitting goes', async () => {
    const { server, ada, mealId } = await setUp()
    const admin = await givenAccount(['admin'])
    await add(server, ada.cookie, mealId, { name: 'Saffron', unit: 'pcs' })

    await send(server, 'DELETE', `/api/admin/meals/${mealId}`, admin.cookie)

    expect(client().prepare('select count(*) as left from meal_ingredient').get()?.left).toBe(0)
  })
})

describe('ticking an ingredient off in the shop', () => {
  it('records who bought it and when, and keeps the first tick', async () => {
    const { server, ada, mealId } = await setUp()
    const bea = await givenAttending('Bea')
    const added = (await add(server, ada.cookie, mealId, { name: 'Saffron', unit: 'pcs' })).json()
    const lineId = added.meal.ingredients[0].id

    expect((await send(server, 'PUT', `/api/meal-ingredients/${lineId}/bought`, ada.cookie)).statusCode).toBe(
      204,
    )
    await send(server, 'PUT', `/api/meal-ingredients/${lineId}/bought`, bea.cookie)

    const { ingredients } = await sittingFrom(server, ada.cookie, mealId)

    expect(ingredients[0]?.bought).toEqual({ by: ada.id, by_name: 'Ada', at: NOW })
  })

  it('unticks one', async () => {
    const { server, ada, mealId } = await setUp()
    const added = (await add(server, ada.cookie, mealId, { name: 'Saffron', unit: 'pcs' })).json()
    const lineId = added.meal.ingredients[0].id
    await send(server, 'PUT', `/api/meal-ingredients/${lineId}/bought`, ada.cookie)

    expect(
      (await send(server, 'DELETE', `/api/meal-ingredients/${lineId}/bought`, ada.cookie)).statusCode,
    ).toBe(204)
    expect((await sittingFrom(server, ada.cookie, mealId)).ingredients[0]?.bought).toBeNull()
  })

  it('leaves the plan alone: a tick is shopping, not a change to the sitting', async () => {
    const { server, ada, mealId } = await setUp()
    const added = (await add(server, ada.cookie, mealId, { name: 'Saffron', unit: 'pcs' })).json()

    await send(server, 'PUT', `/api/meal-ingredients/${added.meal.ingredients[0].id}/bought`, ada.cookie)

    expect(await entriesOn(server, ada.cookie, mealId)).toEqual([['edited', 'changed what it needs']])
  })
})

describe('what the sitting’s card says about it', () => {
  it('says the plan moved, once, however many lines are written', async () => {
    const { server, ada, mealId } = await setUp()
    const lentils = await givenPantryItem('Lentils, red')

    await add(server, ada.cookie, mealId, { pantry_item_id: lentils, amount: 1 })
    await add(server, ada.cookie, mealId, { name: 'Saffron', unit: 'pcs', amount: 2 })
    const added = (await sittingFrom(server, ada.cookie, mealId)).ingredients
    await send(server, 'PATCH', `/api/meal-ingredients/${added[0]?.id}`, ada.cookie, { amount: 3 })
    await send(server, 'DELETE', `/api/meal-ingredients/${added[1]?.id}`, ada.cookie)

    expect(await entriesOn(server, ada.cookie, mealId)).toEqual([['edited', 'changed what it needs']])
  })

  it('tells nobody: nothing here is done to anybody', async () => {
    const { server, ada, mealId } = await setUp()
    await givenAttending('Bea')

    await add(server, ada.cookie, mealId, { name: 'Saffron', unit: 'pcs' })

    expect(client().prepare('select count(*) as sent from notification').get()?.sent).toBe(0)
  })
})

describe('who may write the ingredients', () => {
  it('turns away somebody who is not signed in', async () => {
    const { server, mealId } = await setUp()

    expect((await add(server, '', mealId, { name: 'Saffron', unit: 'pcs' })).statusCode).toBe(401)
  })

  it('turns away an account with no role yet', async () => {
    const { server, mealId } = await setUp()
    const nobody = await givenAccount([])

    expect((await add(server, nobody.cookie, mealId, { name: 'Saffron', unit: 'pcs' })).statusCode).toBe(403)
  })

  it('lets an admin who is not coming write them, and a member who is not attending too', async () => {
    const { server, mealId } = await setUp()
    const admin = await givenAccount(['admin'])
    const member = await givenAccount(['member'])

    expect((await add(server, admin.cookie, mealId, { name: 'Saffron', unit: 'pcs' })).statusCode).toBe(201)
    expect((await add(server, member.cookie, mealId, { name: 'Pepper', unit: 'g' })).statusCode).toBe(201)
  })

  it('refuses every write once the burn has ended', async () => {
    const server = await build()
    await givenBurn(ENDED, '2025')
    const ada = await givenAttending('Ada', ENDED)
    const mealId = await givenSitting(ENDED, '2025-08-01')
    const lineId = randomUUID()
    client()
      .prepare('insert into meal_ingredient (id, meal_id, name, unit, created_at) values (?, ?, ?, ?, ?)')
      .run(lineId, mealId, 'Saffron', 'pcs', NOW)

    expect(
      (await send(server, 'POST', `/api/meals/${mealId}/ingredients`, ada.cookie, { name: 'X', unit: 'g' }))
        .statusCode,
    ).toBe(404)
    expect(
      (await send(server, 'PATCH', `/api/meal-ingredients/${lineId}`, ada.cookie, { amount: 1 })).statusCode,
    ).toBe(404)
    expect((await send(server, 'DELETE', `/api/meal-ingredients/${lineId}`, ada.cookie)).statusCode).toBe(404)
    expect((await send(server, 'PUT', `/api/meal-ingredients/${lineId}/bought`, ada.cookie)).statusCode).toBe(
      404,
    )
    expect(
      (await send(server, 'DELETE', `/api/meal-ingredients/${lineId}/bought`, ada.cookie)).statusCode,
    ).toBe(404)
  })

  it('is a 404 for a line nobody wrote', async () => {
    const { server, ada } = await setUp()

    expect(
      (await send(server, 'PATCH', `/api/meal-ingredients/${randomUUID()}`, ada.cookie, { amount: 1 }))
        .statusCode,
    ).toBe(404)
  })
})

describe('what the table itself refuses, which no route has to be trusted for', () => {
  const insert = (values: Record<string, null | number | string>) => {
    const columns = Object.keys(values)
    const statement = client().prepare(
      `INSERT INTO meal_ingredient (${columns.map((column) => `"${column}"`).join(', ')}) ` +
        `VALUES (${columns.map(() => '?').join(', ')})`,
    )

    return () => statement.run(...Object.values(values))
  }

  const ground = async () => {
    const server = await build()
    await givenBurn()
    const mealId = await givenSitting()
    const itemId = await givenPantryItem('Lentils, red')

    return { server, mealId, itemId }
  }

  const row = (mealId: string, over: Record<string, null | number | string> = {}) => ({
    id: randomUUID(),
    meal_id: mealId,
    created_at: NOW,
    ...over,
  })

  it('takes a pick and takes a special buy', async () => {
    const { mealId, itemId } = await ground()

    expect(insert(row(mealId, { pantry_item_id: itemId, amount: 1 }))).not.toThrow()
    expect(insert(row(mealId, { name: 'Saffron', unit: 'pcs', amount: 2 }))).not.toThrow()
  })

  it('refuses a line that is both, and one that is neither', async () => {
    const { mealId, itemId } = await ground()

    expect(insert(row(mealId, { pantry_item_id: itemId, name: 'Saffron', unit: 'pcs' }))).toThrow()
    expect(insert(row(mealId, { amount: 1 }))).toThrow()
  })

  it('refuses a unit on a pick, which inherits the pantry’s', async () => {
    const { mealId, itemId } = await ground()

    expect(insert(row(mealId, { pantry_item_id: itemId, unit: 'pkt' }))).toThrow()
  })

  it('refuses a special buy with no unit, or a name or unit of only spaces', async () => {
    const { mealId } = await ground()

    expect(insert(row(mealId, { name: 'Saffron' }))).toThrow()
    expect(insert(row(mealId, { name: 'Saffron', unit: null }))).toThrow()
    expect(insert(row(mealId, { name: '  ', unit: 'pcs' }))).toThrow()
    expect(insert(row(mealId, { name: 'Saffron', unit: ' ' }))).toThrow()
  })

  it('refuses an amount below nothing, and takes none at all', async () => {
    const { mealId, itemId } = await ground()

    expect(insert(row(mealId, { pantry_item_id: itemId, amount: -1 }))).toThrow()
    expect(insert(row(mealId, { pantry_item_id: itemId, amount: null }))).not.toThrow()
  })

  it('refuses a sitting that feeds nobody, and takes one that feeds one', async () => {
    await ground()
    const sitting = (serves: number) => () =>
      client()
        .prepare(
          'insert into meal (id, event_id, date, at, label, kind, food_idea, serves) values (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(randomUUID(), BURN, '2026-08-02', '12:00', `Lunch ${serves}`, 'meal', '', serves)

    expect(sitting(0)).toThrow()
    expect(sitting(1)).not.toThrow()
  })
})
