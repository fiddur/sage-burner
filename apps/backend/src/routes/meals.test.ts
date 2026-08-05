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
import { sittingDates } from './meals.ts'

const SECRET = 's'.repeat(40)
const NOW = '2026-07-02T00:00:00.000Z'
const BURN = '9f1c2f2a-6f1a-4a2e-9c6d-2f0a1b3c4d5e'

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

const givenAccount = async (roles: ('admin' | 'member')[], name: string | null = null) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, name, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return { id, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
}

const givenBurn = async (over: { start_time?: string; end_time?: string } = {}) => {
  await db()
    .insert(event)
    .values({
      id: BURN,
      name: 'Summer burn',
      slug: 'summer-burn',
      start_date: '2026-08-01',
      end_date: '2026-08-03',
      start_time: over.start_time ?? '00:00',
      end_time: over.end_time ?? '23:59',
      member_cap: 42,
      created_at: NOW,
    })
  return BURN
}

const givenAttending = async (name: string | null = null) => {
  const who = await givenAccount(['member'], name)
  await db().insert(attendance).values({
    id: randomUUID(),
    event_id: BURN,
    account_id: who.id,
    joined_at: NOW,
    payment_status: 'unpaid',
  })
  return who
}

const send = (
  server: FastifyInstance,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  cookie: string | undefined,
  payload?: Record<string, unknown>,
) =>
  server.inject({ method, url, headers: cookie === undefined ? {} : { cookie }, ...(payload && { payload }) })

const addSlot = (server: FastifyInstance, cookie: string, body: Record<string, unknown>) =>
  send(server, 'POST', `/api/admin/events/${BURN}/meal-slots`, cookie, body)

const generate = (server: FastifyInstance, cookie: string) =>
  send(server, 'POST', `/api/admin/events/${BURN}/meals/generate`, cookie)

const listMeals = async (server: FastifyInstance, cookie: string) =>
  (await send(server, 'GET', `/api/events/${BURN}/meals`, cookie)).json()

describe('which days a sitting falls on', () => {
  const burn = {
    start_date: '2026-08-01',
    end_date: '2026-08-03',
    start_time: '16:00',
    end_time: '12:00',
  }

  it('skips the ends the burn is not open for', () => {
    // The spreadsheet's own plan starts at a Sunday dinner and ends at a Sunday lunch
    // for this reason: nobody eats a lunch on a day they arrive at four, nor on a day
    // everybody has gone by noon. This burn is open for a 13:00 sitting on one day.
    expect(sittingDates({ ...burn }, '13:00')).toEqual(['2026-08-02'])
  })

  it('skips the last day when everyone has gone by then', () => {
    expect(sittingDates({ ...burn }, '18:00')).toEqual(['2026-08-01', '2026-08-02'])
  })

  it('keeps every day when the hours are wide enough for it', () => {
    // The passing sibling. A filter that dropped the first and last day outright
    // would satisfy both tests above while losing meals people do eat.
    expect(sittingDates({ ...burn, start_time: '10:00', end_time: '20:00' }, '13:00')).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
    ])
  })

  it('gives every day for a burn that runs the whole clock', () => {
    expect(sittingDates({ ...burn, start_time: '00:00', end_time: '23:59' }, '09:00')).toHaveLength(3)
  })
})

describe('meal slots', () => {
  it('is admin only, and the member routes are not', async () => {
    const server = await build()
    await givenBurn()
    const member = await givenAttending()

    expect((await addSlot(server, member.cookie, { label: 'Lunch', at: '13:00' })).statusCode).toBe(403)
    expect((await generate(server, member.cookie)).statusCode).toBe(403)
    expect((await send(server, 'GET', `/api/events/${BURN}/meals`, member.cookie)).statusCode).toBe(200)
  })

  it('adds one, and defaults it to a meal rather than a chore', async () => {
    const server = await build()
    await givenBurn()
    const organiser = await givenAccount(['admin'])

    const response = await addSlot(server, organiser.cookie, { label: 'Lunch', at: '13:00' })

    expect(response.statusCode).toBe(201)
    expect(response.json().slots).toMatchObject([{ label: 'Lunch', at: '13:00', kind: 'meal', order: 0 }])
  })

  it('takes a chore, which is what a morning cleanup is', async () => {
    const server = await build()
    await givenBurn()
    const organiser = await givenAccount(['admin'])

    const response = await addSlot(server, organiser.cookie, {
      label: 'Morning cleanup',
      at: '09:00',
      kind: 'chore',
    })

    expect(response.json().slots[0]).toMatchObject({ kind: 'chore' })
  })

  it('refuses a time that is not one', async () => {
    const server = await build()
    await givenBurn()
    const organiser = await givenAccount(['admin'])

    expect((await addSlot(server, organiser.cookie, { label: 'Lunch', at: '1pm' })).statusCode).toBe(400)
    expect((await addSlot(server, organiser.cookie, { label: '   ', at: '13:00' })).statusCode).toBe(400)
  })
})

describe('generating the sittings', () => {
  it('writes one per slot per day the burn is open for it', async () => {
    const server = await build()
    await givenBurn({ start_time: '16:00', end_time: '12:00' })
    const organiser = await givenAccount(['admin'])
    await addSlot(server, organiser.cookie, { label: 'Lunch', at: '13:00' })
    await addSlot(server, organiser.cookie, { label: 'Dinner', at: '18:00' })

    const response = await generate(server, organiser.cookie)

    expect(response.statusCode).toBe(201)
    expect(
      response.json().meals.map((meal: { date: string; label: string }) => `${meal.date} ${meal.label}`),
    ).toEqual([
      // The 1st opens at 16:00, so no lunch there; the 3rd closes at 12:00, so
      // neither a 13:00 lunch nor an 18:00 dinner survives on it.
      '2026-08-01 Dinner',
      '2026-08-02 Lunch',
      '2026-08-02 Dinner',
    ])
  })

  it('adds only what is missing when it runs again', async () => {
    const server = await build()
    await givenBurn()
    const organiser = await givenAccount(['admin'])
    await addSlot(server, organiser.cookie, { label: 'Lunch', at: '13:00' })
    await generate(server, organiser.cookie)

    await addSlot(server, organiser.cookie, { label: 'Dinner', at: '18:00' })
    const second = await generate(server, organiser.cookie)

    const labels = second.json().meals.map((meal: { label: string }) => meal.label)
    expect(labels.filter((label: string) => label === 'Lunch')).toHaveLength(3)
    expect(labels.filter((label: string) => label === 'Dinner')).toHaveLength(3)
  })

  it('leaves a sitting that has been moved where it was put', async () => {
    // The point of rows over a rule. A regeneration that rewrote times would undo
    // every deliberate change an organiser had made.
    const server = await build()
    await givenBurn()
    const organiser = await givenAccount(['admin'])
    await addSlot(server, organiser.cookie, { label: 'Dinner', at: '18:00' })
    await generate(server, organiser.cookie)
    const [first] = (await listMeals(server, organiser.cookie)).meals
    await send(server, 'PATCH', `/api/meals/${first.id}`, organiser.cookie, { at: '19:30' })

    await generate(server, organiser.cookie)

    const after = (await listMeals(server, organiser.cookie)).meals
    expect(after).toHaveLength(3)
    expect(after.find((meal: { id: string }) => meal.id === first.id).at).toBe('19:30')
  })

  it('never removes one, however the slots change', async () => {
    // Somebody may already have signed up to cook it.
    const server = await build()
    await givenBurn()
    const organiser = await givenAccount(['admin'])
    const created = await addSlot(server, organiser.cookie, { label: 'Lunch', at: '13:00' })
    await generate(server, organiser.cookie)

    await send(server, 'DELETE', `/api/admin/meal-slots/${created.json().slots[0].id}`, organiser.cookie)
    await generate(server, organiser.cookie)

    expect((await listMeals(server, organiser.cookie)).meals).toHaveLength(3)
  })

  it('leaves what a renamed slot already made alone', async () => {
    const server = await build()
    await givenBurn()
    const organiser = await givenAccount(['admin'])
    const created = await addSlot(server, organiser.cookie, { label: 'Lunch', at: '13:00' })
    await generate(server, organiser.cookie)

    await send(server, 'PATCH', `/api/admin/meal-slots/${created.json().slots[0].id}`, organiser.cookie, {
      label: 'Brunch',
    })

    const labels = (await listMeals(server, organiser.cookie)).meals.map(
      (meal: { label: string }) => meal.label,
    )
    expect(labels).toEqual(['Lunch', 'Lunch', 'Lunch'])
  })
})

describe('signing up for a meal', () => {
  const setUp = async () => {
    const server = await build()
    await givenBurn()
    const organiser = await givenAccount(['admin'])
    await addSlot(server, organiser.cookie, { label: 'Dinner', at: '18:00' })
    await generate(server, organiser.cookie)
    const ada = await givenAttending('Ada')
    const [meal] = (await listMeals(server, ada.cookie)).meals

    return { server, organiser, ada, meal }
  }

  it('takes the lead, hands it on, and vacates it', async () => {
    const { server, ada, meal } = await setUp()
    const bea = await givenAttending('Bea')

    const taken = await send(server, 'PUT', `/api/meals/${meal.id}/lead`, ada.cookie, { account_id: ada.id })
    expect(taken.json().meal.lead).toEqual({ account_id: ada.id, name: 'Ada' })

    const handed = await send(server, 'PUT', `/api/meals/${meal.id}/lead`, ada.cookie, { account_id: bea.id })
    expect(handed.json().meal.lead).toEqual({ account_id: bea.id, name: 'Bea' })

    const vacated = await send(server, 'PUT', `/api/meals/${meal.id}/lead`, ada.cookie, { account_id: null })
    expect(vacated.json().meal.lead).toBeNull()
  })

  it('refuses a lead who is not coming to the burn', async () => {
    const { server, ada, meal } = await setUp()
    const elsewhere = await givenAccount(['member'])

    const response = await send(server, 'PUT', `/api/meals/${meal.id}/lead`, ada.cookie, {
      account_id: elsewhere.id,
    })

    expect(response.statusCode).toBe(400)
  })

  it('stands for helping and for cleaning, which are separate', async () => {
    const { server, ada, meal } = await setUp()

    await send(server, 'PUT', `/api/meals/${meal.id}/helper/me`, ada.cookie)
    const both = await send(server, 'PUT', `/api/meals/${meal.id}/cleanup/me`, ada.cookie)

    expect(both.json().meal.helpers).toHaveLength(1)
    expect(both.json().meal.cleanup).toHaveLength(1)

    const off = await send(server, 'DELETE', `/api/meals/${meal.id}/helper/me`, ada.cookie)
    expect(off.json().meal.helpers).toEqual([])
    expect(off.json().meal.cleanup).toHaveLength(1)
  })

  it('is the same after two clicks as after one', async () => {
    const { server, ada, meal } = await setUp()

    await send(server, 'PUT', `/api/meals/${meal.id}/helper/me`, ada.cookie)
    const again = await send(server, 'PUT', `/api/meals/${meal.id}/helper/me`, ada.cookie)

    expect(again.json().meal.helpers).toHaveLength(1)
  })

  it('knows no role called lead here, since one person holds it', async () => {
    const { server, ada, meal } = await setUp()

    expect((await send(server, 'PUT', `/api/meals/${meal.id}/lead/me`, ada.cookie)).statusCode).toBe(404)
  })

  it('refuses somebody who is not coming to that burn', async () => {
    const { server, meal } = await setUp()
    const elsewhere = await givenAccount(['member'])

    expect((await send(server, 'PUT', `/api/meals/${meal.id}/helper/me`, elsewhere.cookie)).statusCode).toBe(
      400,
    )
  })
})

describe('the plan itself', () => {
  const setUp = async () => {
    const server = await build()
    await givenBurn()
    const organiser = await givenAccount(['admin'])
    await addSlot(server, organiser.cookie, { label: 'Dinner', at: '18:00' })
    await generate(server, organiser.cookie)
    const [meal] = (await listMeals(server, organiser.cookie)).meals

    return { server, organiser, meal }
  }

  it('lets any member move one, because the schedule is theirs', async () => {
    const { server, meal } = await setUp()
    const ada = await givenAttending()

    const response = await send(server, 'PATCH', `/api/meals/${meal.id}`, ada.cookie, { at: '19:00' })

    expect(response.statusCode).toBe(200)
    expect(response.json().meal.at).toBe('19:00')
  })

  it('keeps adding and dropping one to admin, because those decide whether people eat', async () => {
    const { server, meal } = await setUp()
    const ada = await givenAttending()

    expect(
      (
        await send(server, 'POST', `/api/admin/events/${BURN}/meals`, ada.cookie, {
          date: '2026-08-02',
          at: '22:00',
          label: 'Late supper',
        })
      ).statusCode,
    ).toBe(403)
    expect((await send(server, 'DELETE', `/api/admin/meals/${meal.id}`, ada.cookie)).statusCode).toBe(403)
  })

  it('adds one the slots never made', async () => {
    const { server, organiser } = await setUp()

    const response = await send(server, 'POST', `/api/admin/events/${BURN}/meals`, organiser.cookie, {
      date: '2026-08-02',
      at: '22:00',
      label: 'Late supper',
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().meal).toMatchObject({ label: 'Late supper', at: '22:00', kind: 'meal' })
  })

  it('refuses a second sitting of the same name on the same day', async () => {
    const { server, organiser, meal } = await setUp()

    const response = await send(server, 'POST', `/api/admin/events/${BURN}/meals`, organiser.cookie, {
      date: meal.date,
      at: '20:00',
      label: meal.label,
    })

    expect(response.statusCode).toBe(409)
  })

  it('drops one, and everybody signed up for it', async () => {
    const { server, organiser, meal } = await setUp()
    const ada = await givenAttending()
    await send(server, 'PUT', `/api/meals/${meal.id}/helper/me`, ada.cookie)

    expect((await send(server, 'DELETE', `/api/admin/meals/${meal.id}`, organiser.cookie)).statusCode).toBe(
      204,
    )
    expect((await listMeals(server, organiser.cookie)).meals).toHaveLength(2)
  })

  it('writes a food idea, and clears it', async () => {
    const { server, meal } = await setUp()
    const ada = await givenAttending()

    const written = await send(server, 'PUT', `/api/meals/${meal.id}/idea`, ada.cookie, {
      food_idea: '  Vegan bolognese  ',
    })
    expect(written.json().meal.food_idea).toBe('Vegan bolognese')

    const cleared = await send(server, 'PUT', `/api/meals/${meal.id}/idea`, ada.cookie, { food_idea: '' })
    expect(cleared.json().meal.food_idea).toBe('')
  })

  it('rewrites the words above the table, for any member', async () => {
    const { server } = await setUp()
    const ada = await givenAttending()

    const response = await send(server, 'PATCH', `/api/events/${BURN}/meal-intro`, ada.cookie, {
      meal_intro_markdown: '**Breakfast is DIY** in the party kitchen.',
    })

    expect(response.statusCode).toBe(200)
    expect((await listMeals(server, ada.cookie)).intro_markdown).toContain('Breakfast is DIY')
  })
})

describe('a burn that has ended', () => {
  /**
   * The rule every bare-id route here follows: the burn is resolved from the row and
   * refused if it is over. Without it a dream in a past burn could not be moved while
   * the meal block beside it on the same grid could, and anybody could rewrite who
   * cooked last summer.
   */
  const ENDED = 'b1b2b3b4-0000-4000-8000-00000000dead'

  const setUp = async () => {
    const server = await build()
    await db().insert(event).values({
      id: ENDED,
      name: 'Last summer',
      slug: 'last-summer',
      start_date: '2025-08-01',
      end_date: '2025-08-03',
      start_time: '00:00',
      end_time: '23:59',
      member_cap: 42,
      created_at: NOW,
    })
    const organiser = await givenAccount(['admin', 'member'])
    await db().insert(attendance).values({
      id: randomUUID(),
      event_id: ENDED,
      account_id: organiser.id,
      joined_at: NOW,
      payment_status: 'unpaid',
    })
    await send(server, 'POST', `/api/admin/events/${ENDED}/meal-slots`, organiser.cookie, {
      label: 'Dinner',
      at: '18:00',
    })
    await send(server, 'POST', `/api/admin/events/${ENDED}/meals/generate`, organiser.cookie)
    const [meal] = (await send(server, 'GET', `/api/events/${ENDED}/meals`, organiser.cookie)).json().meals

    return { server, organiser, meal }
  }

  it('refuses every member-facing write', async () => {
    const { server, organiser, meal } = await setUp()

    expect(
      (await send(server, 'PATCH', `/api/meals/${meal.id}`, organiser.cookie, { at: '19:00' })).statusCode,
    ).toBe(404)
    expect(
      (
        await send(server, 'PUT', `/api/meals/${meal.id}/lead`, organiser.cookie, {
          account_id: organiser.id,
        })
      ).statusCode,
    ).toBe(404)
    expect((await send(server, 'PUT', `/api/meals/${meal.id}/helper/me`, organiser.cookie)).statusCode).toBe(
      404,
    )
    expect(
      (await send(server, 'DELETE', `/api/meals/${meal.id}/cleanup/me`, organiser.cookie)).statusCode,
    ).toBe(404)
    expect(
      (await send(server, 'PUT', `/api/meals/${meal.id}/idea`, organiser.cookie, { food_idea: 'x' }))
        .statusCode,
    ).toBe(404)
    expect(
      (
        await send(server, 'PATCH', `/api/events/${ENDED}/meal-intro`, organiser.cookie, {
          meal_intro_markdown: 'x',
        })
      ).statusCode,
    ).toBe(404)
  })

  it('leaves the record alone when a write is refused', async () => {
    const { server, organiser, meal } = await setUp()

    await send(server, 'PATCH', `/api/meals/${meal.id}`, organiser.cookie, { at: '19:00' })
    await send(server, 'PUT', `/api/meals/${meal.id}/idea`, organiser.cookie, { food_idea: 'Tacos' })

    const after = (await send(server, 'GET', `/api/events/${ENDED}/meals`, organiser.cookie)).json().meals[0]
    expect(after.at).toBe('18:00')
    expect(after.food_idea).toBe('')
  })

  it('still reads it, because a finished burn’s meals are its record', async () => {
    const { server, organiser } = await setUp()

    const response = await send(server, 'GET', `/api/events/${ENDED}/meals`, organiser.cookie)

    expect(response.statusCode).toBe(200)
    expect(response.json().meals).toHaveLength(3)
  })

  it('still takes every one of those writes on a burn that has not ended', async () => {
    // The passing sibling for all six: a guard that refused unconditionally would
    // satisfy the test above while making the feature useless.
    const server = await build()
    await givenBurn()
    const organiser = await givenAccount(['admin'])
    const ada = await givenAttending()
    await addSlot(server, organiser.cookie, { label: 'Dinner', at: '18:00' })
    await generate(server, organiser.cookie)
    const [meal] = (await listMeals(server, ada.cookie)).meals

    expect(
      (await send(server, 'PATCH', `/api/meals/${meal.id}`, ada.cookie, { at: '19:00' })).statusCode,
    ).toBe(200)
    expect(
      (await send(server, 'PUT', `/api/meals/${meal.id}/lead`, ada.cookie, { account_id: ada.id }))
        .statusCode,
    ).toBe(200)
    expect((await send(server, 'PUT', `/api/meals/${meal.id}/helper/me`, ada.cookie)).statusCode).toBe(200)
    expect((await send(server, 'DELETE', `/api/meals/${meal.id}/cleanup/me`, ada.cookie)).statusCode).toBe(
      200,
    )
    expect(
      (await send(server, 'PUT', `/api/meals/${meal.id}/idea`, ada.cookie, { food_idea: 'Tacos' }))
        .statusCode,
    ).toBe(200)
    expect(
      (
        await send(server, 'PATCH', `/api/events/${BURN}/meal-intro`, ada.cookie, {
          meal_intro_markdown: 'x',
        })
      ).statusCode,
    ).toBe(200)
  })
})
