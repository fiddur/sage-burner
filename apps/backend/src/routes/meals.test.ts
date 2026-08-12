import type { FastifyInstance } from 'fastify'

import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DbHandle } from '../db/index.ts'
import type { Delivery } from '../push/push.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { isForeignKeyViolation, isUniqueViolation } from '../db/errors.ts'
import { createDb, runMigrations } from '../db/index.ts'
import {
  account,
  accountRole,
  attendance,
  event,
  mealSlot,
  meal as mealTable,
  pushSubscription,
} from '../db/schema.ts'
import { sendGuarded } from '../if-match.testing.ts'
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

const build = async (deliver: Delivery = () => Promise.resolve('sent')) => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: SECRET }),
    now: () => new Date(NOW),
    deliver,
    mintKeys: () => ({ publicKey: 'a-public-key', privateKey: 'a-private-key' }),
  })
  return app
}

/** One browser opted in, so there is somewhere for a notification to go. */
const givenSubscribed = async (accountId: string) => {
  await db()
    .insert(pushSubscription)
    .values({
      id: randomUUID(),
      endpoint: `https://push.example.org/${randomUUID()}`,
      account_id: accountId,
      p256dh: 'a-key',
      auth: 'a-secret',
      created_at: NOW,
    })
}

/** What was pushed, as the strings a person would read. */
const messagesFrom = (deliver: ReturnType<typeof vi.fn<Delivery>>) =>
  deliver.mock.calls.map((call) => {
    const parsed: unknown = JSON.parse(String(call[1]))
    return typeof parsed === 'object' && parsed !== null && 'body' in parsed ? String(parsed.body) : ''
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
  sendGuarded((extra) =>
    server.inject({
      method,
      url,
      headers: { ...(cookie === undefined ? {} : { cookie }), ...extra },
      ...(payload && { payload }),
    }),
  )

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
    const admin = await givenAccount(['admin'])

    const response = await addSlot(server, admin.cookie, { label: 'Lunch', at: '13:00' })

    expect(response.statusCode).toBe(201)
    expect(response.json().slots).toMatchObject([{ label: 'Lunch', at: '13:00', kind: 'meal', order: 0 }])
  })

  it('takes a chore, which is what a morning cleanup is', async () => {
    const server = await build()
    await givenBurn()
    const admin = await givenAccount(['admin'])

    const response = await addSlot(server, admin.cookie, {
      label: 'Morning cleanup',
      at: '09:00',
      kind: 'chore',
    })

    expect(response.json().slots[0]).toMatchObject({ kind: 'chore' })
  })

  it('refuses a time that is not one', async () => {
    const server = await build()
    await givenBurn()
    const admin = await givenAccount(['admin'])

    expect((await addSlot(server, admin.cookie, { label: 'Lunch', at: '1pm' })).statusCode).toBe(400)
    expect((await addSlot(server, admin.cookie, { label: '   ', at: '13:00' })).statusCode).toBe(400)
  })

  it('says a burn that does not exist does not, rather than answering with no slots', async () => {
    // It selected by `event_id` and answered 200 for any id at all, while its
    // siblings looked the burn up and 404'd (#217).
    const server = await build()
    await givenBurn()
    const admin = await givenAccount(['admin'])

    const response = await send(
      server,
      'GET',
      `/api/admin/events/2b1f0a9c-0000-4000-8000-000000000000/meal-slots`,
      admin.cookie,
    )

    expect(response.statusCode).toBe(404)
  })

  it('lists them for a burn that does exist', async () => {
    const server = await build()
    await givenBurn()
    const admin = await givenAccount(['admin'])
    await addSlot(server, admin.cookie, { label: 'Lunch', at: '13:00' })

    const response = await send(server, 'GET', `/api/admin/events/${BURN}/meal-slots`, admin.cookie)

    expect(response.statusCode).toBe(200)
    expect(response.json().slots).toHaveLength(1)
  })
})

describe('generating the sittings', () => {
  it('writes one per slot per day the burn is open for it', async () => {
    const server = await build()
    await givenBurn({ start_time: '16:00', end_time: '12:00' })
    const admin = await givenAccount(['admin'])
    await addSlot(server, admin.cookie, { label: 'Lunch', at: '13:00' })
    await addSlot(server, admin.cookie, { label: 'Dinner', at: '18:00' })

    const response = await generate(server, admin.cookie)

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
    const admin = await givenAccount(['admin'])
    await addSlot(server, admin.cookie, { label: 'Lunch', at: '13:00' })
    await generate(server, admin.cookie)

    await addSlot(server, admin.cookie, { label: 'Dinner', at: '18:00' })
    const second = await generate(server, admin.cookie)

    const labels = second.json().meals.map((meal: { label: string }) => meal.label)
    expect(labels.filter((label: string) => label === 'Lunch')).toHaveLength(3)
    expect(labels.filter((label: string) => label === 'Dinner')).toHaveLength(3)
  })

  it('leaves a sitting that has been moved where it was put', async () => {
    // The point of rows over a rule. A regeneration that rewrote times would undo
    // every deliberate change an admin had made.
    const server = await build()
    await givenBurn()
    const admin = await givenAccount(['admin'])
    await addSlot(server, admin.cookie, { label: 'Dinner', at: '18:00' })
    await generate(server, admin.cookie)
    const [first] = (await listMeals(server, admin.cookie)).meals
    await send(server, 'PATCH', `/api/meals/${first.id}`, admin.cookie, { at: '19:30' })

    await generate(server, admin.cookie)

    const after = (await listMeals(server, admin.cookie)).meals
    expect(after).toHaveLength(3)
    expect(after.find((meal: { id: string }) => meal.id === first.id).at).toBe('19:30')
  })

  it('makes a new one for the day a sitting was moved off, because the slot still says so', async () => {
    // The limit of "a moved sitting stays moved" (#216): a sitting is recognised by
    // its day and name, so moving one to another *day* leaves its old day without
    // one — and the slot still says that day has a dinner. The 3rd closes at 12:00,
    // so it is the one day generating never put a dinner on, which is what makes it
    // free to be moved onto.
    const server = await build()
    await givenBurn({ end_time: '12:00' })
    const admin = await givenAccount(['admin'])
    await addSlot(server, admin.cookie, { label: 'Dinner', at: '18:00' })
    await generate(server, admin.cookie)
    const [first] = (await listMeals(server, admin.cookie)).meals
    expect(first.date).toBe('2026-08-01')

    await send(server, 'PATCH', `/api/meals/${first.id}`, admin.cookie, { date: '2026-08-03' })
    await generate(server, admin.cookie)

    const after = (await listMeals(server, admin.cookie)).meals
    expect(after.map((meal: { date: string }) => meal.date)).toEqual([
      // Remade, because the slot still wants one here.
      '2026-08-01',
      '2026-08-02',
      // Where it was dragged, and generating leaves it alone.
      '2026-08-03',
    ])
    expect(after.find((meal: { id: string }) => meal.id === first.id).date).toBe('2026-08-03')
  })

  it('never removes one, however the slots change', async () => {
    // Somebody may already have signed up to cook it.
    const server = await build()
    await givenBurn()
    const admin = await givenAccount(['admin'])
    const created = await addSlot(server, admin.cookie, { label: 'Lunch', at: '13:00' })
    await generate(server, admin.cookie)

    await send(server, 'DELETE', `/api/admin/meal-slots/${created.json().slots[0].id}`, admin.cookie)
    await generate(server, admin.cookie)

    expect((await listMeals(server, admin.cookie)).meals).toHaveLength(3)
  })

  it('leaves what a renamed slot already made alone', async () => {
    const server = await build()
    await givenBurn()
    const admin = await givenAccount(['admin'])
    const created = await addSlot(server, admin.cookie, { label: 'Lunch', at: '13:00' })
    await generate(server, admin.cookie)

    await send(server, 'PATCH', `/api/admin/meal-slots/${created.json().slots[0].id}`, admin.cookie, {
      label: 'Brunch',
    })

    const labels = (await listMeals(server, admin.cookie)).meals.map((meal: { label: string }) => meal.label)
    expect(labels).toEqual(['Lunch', 'Lunch', 'Lunch'])
  })
})

describe('signing up for a meal', () => {
  const setUp = async () => {
    const server = await build()
    await givenBurn()
    const admin = await givenAccount(['admin'])
    await addSlot(server, admin.cookie, { label: 'Dinner', at: '18:00' })
    await generate(server, admin.cookie)
    const ada = await givenAttending('Ada')
    const [meal] = (await listMeals(server, ada.cookie)).meals

    return { server, admin, ada, meal }
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

    await send(server, 'PUT', `/api/meals/${meal.id}/crew/helper`, ada.cookie, { account_id: ada.id })
    const both = await send(server, 'PUT', `/api/meals/${meal.id}/crew/cleanup`, ada.cookie, {
      account_id: ada.id,
    })

    expect(both.json().meal.helpers).toHaveLength(1)
    expect(both.json().meal.cleanup).toHaveLength(1)

    const off = await send(server, 'DELETE', `/api/meals/${meal.id}/crew/helper/${ada.id}`, ada.cookie)
    expect(off.json().meal.helpers).toEqual([])
    expect(off.json().meal.cleanup).toHaveLength(1)
  })

  it('is the same after two clicks as after one', async () => {
    const { server, ada, meal } = await setUp()

    await send(server, 'PUT', `/api/meals/${meal.id}/crew/helper`, ada.cookie, { account_id: ada.id })
    const again = await send(server, 'PUT', `/api/meals/${meal.id}/crew/helper`, ada.cookie, {
      account_id: ada.id,
    })

    expect(again.json().meal.helpers).toHaveLength(1)
  })

  it('knows no role called lead here, since one person holds it', async () => {
    const { server, ada, meal } = await setUp()

    expect(
      (await send(server, 'PUT', `/api/meals/${meal.id}/crew/lead`, ada.cookie, { account_id: ada.id }))
        .statusCode,
    ).toBe(404)
  })

  it('refuses somebody who is not coming to that burn', async () => {
    const { server, meal } = await setUp()
    const elsewhere = await givenAccount(['member'])

    expect(
      (
        await send(server, 'PUT', `/api/meals/${meal.id}/crew/helper`, elsewhere.cookie, {
          account_id: elsewhere.id,
        })
      ).statusCode,
    ).toBe(400)
  })
})

describe('the plan itself', () => {
  const setUp = async () => {
    const server = await build()
    await givenBurn()
    const admin = await givenAccount(['admin'])
    await addSlot(server, admin.cookie, { label: 'Dinner', at: '18:00' })
    await generate(server, admin.cookie)
    const [meal] = (await listMeals(server, admin.cookie)).meals

    return { server, admin, meal }
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
    const { server, admin } = await setUp()

    const response = await send(server, 'POST', `/api/admin/events/${BURN}/meals`, admin.cookie, {
      date: '2026-08-02',
      at: '22:00',
      label: 'Late supper',
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().meal).toMatchObject({ label: 'Late supper', at: '22:00', kind: 'meal' })
  })

  it('refuses a second sitting of the same name on the same day', async () => {
    const { server, admin, meal } = await setUp()

    const response = await send(server, 'POST', `/api/admin/events/${BURN}/meals`, admin.cookie, {
      date: meal.date,
      at: '20:00',
      label: meal.label,
    })

    expect(response.statusCode).toBe(409)
  })

  it('refuses moving one onto a day that already has one by that name', async () => {
    // The burn runs the whole clock, so generating gave every one of its three days a
    // Dinner. Moving the first onto the second's day is the collision.
    const { server, meal } = await setUp()
    const ada = await givenAttending()

    const response = await send(server, 'PATCH', `/api/meals/${meal.id}`, ada.cookie, {
      date: '2026-08-02',
    })

    expect(response.statusCode).toBe(409)
  })

  it('refuses moving one off the days the burn covers', async () => {
    // It would vanish from the schedule, whose rows span the burn's own hours, while
    // still showing on the Meals page — the two views disagreeing about whether it
    // exists at all (#221).
    const { server, meal } = await setUp()
    const ada = await givenAttending()

    expect(
      (await send(server, 'PATCH', `/api/meals/${meal.id}`, ada.cookie, { date: '2026-08-09' })).statusCode,
    ).toBe(400)
    expect(
      (await send(server, 'PATCH', `/api/meals/${meal.id}`, ada.cookie, { date: '2026-07-30' })).statusCode,
    ).toBe(400)
  })

  it('tells a duplicate from anything else, which is what the 409 rests on', async () => {
    // Pinned against a real violation, like `isForeignKeyViolation` and
    // `isCheckViolation`: the predicate is a string match on a driver's message, so a
    // driver rewording it should fail the suite rather than turn a 409 into a 500.
    //
    // The route's own catch cannot be tested both ways — a transient database error
    // is not something this suite can provoke mid-UPDATE — so the narrowing is
    // pinned here, on the predicate the catch asks.
    const { server, admin, meal } = await setUp()
    await send(server, 'GET', `/api/events/${BURN}/meals`, admin.cookie)

    let duplicate: unknown
    try {
      client()
        .prepare('insert into meal (id, event_id, date, at, label, kind, food_idea) values (?,?,?,?,?,?,?)')
        .run(randomUUID(), BURN, meal.date, '20:00', meal.label, 'meal', '')
    } catch (failure) {
      duplicate = failure
    }

    let orphan: unknown
    try {
      client()
        .prepare('insert into meal (id, event_id, date, at, label, kind, food_idea) values (?,?,?,?,?,?,?)')
        .run(randomUUID(), 'no-such-burn', '2026-08-01', '20:00', 'Nowhere', 'meal', '')
    } catch (failure) {
      orphan = failure
    }

    expect(isUniqueViolation(duplicate)).toBe(true)
    expect(isUniqueViolation(orphan)).toBe(false)
    expect(isForeignKeyViolation(orphan)).toBe(true)
    expect(isUniqueViolation(new Error('disk I/O error'))).toBe(false)

    // The targeted form, which three routes now ask in (#142). Without the column
    // doing anything, every one of them would answer 409 to any duplicate — telling
    // a caller "there is already one of those" about a row they never touched.
    expect(isUniqueViolation(duplicate, 'meal.event_id')).toBe(true)
    expect(isUniqueViolation(duplicate, 'account.email')).toBe(false)
  })

  it('allows moving one to another day inside the burn', async () => {
    // The passing sibling the refusals need: three tests saying no, and none saying
    // an ordinary move still works, is where the gap lands.
    const { server, admin } = await setUp()
    const supper = (
      await send(server, 'POST', `/api/admin/events/${BURN}/meals`, admin.cookie, {
        date: '2026-08-02',
        at: '22:00',
        label: 'Late supper',
      })
    ).json().meal

    const response = await send(server, 'PATCH', `/api/meals/${supper.id}`, admin.cookie, {
      date: '2026-08-03',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().meal.date).toBe('2026-08-03')
  })

  it('drops one, and everybody signed up for it', async () => {
    const { server, admin, meal } = await setUp()
    const ada = await givenAttending()
    await send(server, 'PUT', `/api/meals/${meal.id}/crew/helper`, ada.cookie, { account_id: ada.id })

    expect((await send(server, 'DELETE', `/api/admin/meals/${meal.id}`, admin.cookie)).statusCode).toBe(204)
    expect((await listMeals(server, admin.cookie)).meals).toHaveLength(2)
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
    const admin = await givenAccount(['admin', 'member'])
    await db().insert(attendance).values({
      id: randomUUID(),
      event_id: ENDED,
      account_id: admin.id,
      joined_at: NOW,
      payment_status: 'unpaid',
    })
    // Written straight into the tables rather than through the API: laying a finished burn's
    // meals out is one of the things refused, so the fixture cannot use the routes it tests.
    const slot = randomUUID()
    await db()
      .insert(mealSlot)
      .values({ id: slot, event_id: ENDED, order: 0, label: 'Dinner', at: '18:00', kind: 'meal' })
    await db()
      .insert(mealTable)
      .values(
        ['2025-08-01', '2025-08-02', '2025-08-03'].map((date) => ({
          id: randomUUID(),
          event_id: ENDED,
          date,
          at: '18:00',
          label: 'Dinner',
          kind: 'meal' as const,
          food_idea: '',
        })),
      )
    const [meal] = (await send(server, 'GET', `/api/events/${ENDED}/meals`, admin.cookie)).json().meals

    return { server, admin, meal, slot }
  }

  it('refuses every member-facing write', async () => {
    const { server, admin, meal } = await setUp()

    expect(
      (await send(server, 'PATCH', `/api/meals/${meal.id}`, admin.cookie, { at: '19:00' })).statusCode,
    ).toBe(404)
    expect(
      (
        await send(server, 'PUT', `/api/meals/${meal.id}/lead`, admin.cookie, {
          account_id: admin.id,
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (
        await send(server, 'PUT', `/api/meals/${meal.id}/crew/helper`, admin.cookie, {
          account_id: admin.id,
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (await send(server, 'DELETE', `/api/meals/${meal.id}/crew/cleanup/${admin.id}`, admin.cookie))
        .statusCode,
    ).toBe(404)
    expect(
      (await send(server, 'PUT', `/api/meals/${meal.id}/idea`, admin.cookie, { food_idea: 'x' })).statusCode,
    ).toBe(404)
    expect(
      (
        await send(server, 'PATCH', `/api/events/${ENDED}/meal-intro`, admin.cookie, {
          meal_intro_markdown: 'x',
        })
      ).statusCode,
    ).toBe(404)
  })

  it('refuses the admin’s own writes too, which is where sittings come from (#508)', async () => {
    const { server, admin, slot } = await setUp()

    expect(
      (
        await send(server, 'POST', `/api/admin/events/${ENDED}/meal-slots`, admin.cookie, {
          label: 'Breakfast',
          at: '08:00',
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (await send(server, 'PATCH', `/api/admin/meal-slots/${slot}`, admin.cookie, { at: '19:00' }))
        .statusCode,
    ).toBe(404)
    expect((await send(server, 'DELETE', `/api/admin/meal-slots/${slot}`, admin.cookie)).statusCode).toBe(404)
    expect(
      (await send(server, 'POST', `/api/admin/events/${ENDED}/meals/generate`, admin.cookie)).statusCode,
    ).toBe(404)
  })

  it('lays no new sittings into a burn that is over, which is a record now', async () => {
    const { server, admin } = await setUp()

    await send(server, 'POST', `/api/admin/events/${ENDED}/meals/generate`, admin.cookie)

    expect((await send(server, 'GET', `/api/events/${ENDED}/meals`, admin.cookie)).json().meals).toHaveLength(
      3,
    )
  })

  it('leaves the record alone when a write is refused', async () => {
    const { server, admin, meal } = await setUp()

    await send(server, 'PATCH', `/api/meals/${meal.id}`, admin.cookie, { at: '19:00' })
    await send(server, 'PUT', `/api/meals/${meal.id}/idea`, admin.cookie, { food_idea: 'Tacos' })

    const after = (await send(server, 'GET', `/api/events/${ENDED}/meals`, admin.cookie)).json().meals[0]
    expect(after.at).toBe('18:00')
    expect(after.food_idea).toBe('')
  })

  it('still reads it, because a finished burn’s meals are its record', async () => {
    const { server, admin } = await setUp()

    const response = await send(server, 'GET', `/api/events/${ENDED}/meals`, admin.cookie)

    expect(response.statusCode).toBe(200)
    expect(response.json().meals).toHaveLength(3)
  })

  it('still takes every one of those writes on a burn that has not ended', async () => {
    // The passing sibling for all six: a guard that refused unconditionally would
    // satisfy the test above while making the feature useless.
    const server = await build()
    await givenBurn()
    const admin = await givenAccount(['admin'])
    const ada = await givenAttending()
    await addSlot(server, admin.cookie, { label: 'Dinner', at: '18:00' })
    await generate(server, admin.cookie)
    const [meal] = (await listMeals(server, ada.cookie)).meals

    expect(
      (await send(server, 'PATCH', `/api/meals/${meal.id}`, ada.cookie, { at: '19:00' })).statusCode,
    ).toBe(200)
    expect(
      (await send(server, 'PUT', `/api/meals/${meal.id}/lead`, ada.cookie, { account_id: ada.id }))
        .statusCode,
    ).toBe(200)
    expect(
      (await send(server, 'PUT', `/api/meals/${meal.id}/crew/helper`, ada.cookie, { account_id: ada.id }))
        .statusCode,
    ).toBe(200)
    expect(
      (await send(server, 'DELETE', `/api/meals/${meal.id}/crew/cleanup/${ada.id}`, ada.cookie)).statusCode,
    ).toBe(200)
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

describe('a chore', () => {
  /**
   * Nothing is cooked at a morning cleanup, so it has nobody leading the cooking and
   * nobody helping with it — only cleaners. Refused rather than only hidden: the page
   * not offering a control is not the rule.
   */
  const setUp = async () => {
    const server = await build()
    await givenBurn()
    const admin = await givenAccount(['admin'])
    await addSlot(server, admin.cookie, { label: 'Morning cleanup', at: '09:00', kind: 'chore' })
    await addSlot(server, admin.cookie, { label: 'Dinner', at: '18:00' })
    await generate(server, admin.cookie)
    const ada = await givenAttending()
    const meals = (await listMeals(server, ada.cookie)).meals
    const chore = meals.find((one: { kind: string }) => one.kind === 'chore')
    const meal = meals.find((one: { kind: string }) => one.kind === 'meal')

    return { server, ada, chore, meal }
  }

  it('takes nobody as its lead', async () => {
    const { server, ada, chore } = await setUp()

    const response = await send(server, 'PUT', `/api/meals/${chore.id}/lead`, ada.cookie, {
      account_id: ada.id,
    })

    expect(response.statusCode).toBe(400)
  })

  it('takes nobody to help cook, because nothing is cooked', async () => {
    const { server, ada, chore } = await setUp()

    expect(
      (await send(server, 'PUT', `/api/meals/${chore.id}/crew/helper`, ada.cookie, { account_id: ada.id }))
        .statusCode,
    ).toBe(400)
  })

  it('takes cleaners, which is the whole of what it wants', async () => {
    const { server, ada, chore } = await setUp()

    const response = await send(server, 'PUT', `/api/meals/${chore.id}/crew/cleanup`, ada.cookie, {
      account_id: ada.id,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().meal.cleanup).toHaveLength(1)
  })

  it('leaves an ordinary meal alone', async () => {
    // The passing sibling for all three: a rule applied to every sitting would
    // satisfy them while making the feature useless.
    const { server, ada, meal } = await setUp()

    expect(
      (await send(server, 'PUT', `/api/meals/${meal.id}/lead`, ada.cookie, { account_id: ada.id }))
        .statusCode,
    ).toBe(200)
    expect(
      (await send(server, 'PUT', `/api/meals/${meal.id}/crew/helper`, ada.cookie, { account_id: ada.id }))
        .statusCode,
    ).toBe(200)
  })

  it('lets somebody stand down from helping even after the slot became a chore', async () => {
    // Only joining is refused. A sitting changed to a chore under somebody who had
    // already put their name to it must not trap them there.
    const { server, ada, meal } = await setUp()
    await send(server, 'PUT', `/api/meals/${meal.id}/crew/helper`, ada.cookie, { account_id: ada.id })
    await db().update(mealTable).set({ kind: 'chore' }).where(eq(mealTable.id, meal.id))

    const response = await send(server, 'DELETE', `/api/meals/${meal.id}/crew/helper/${ada.id}`, ada.cookie)

    expect(response.statusCode).toBe(200)
    expect(response.json().meal.helpers).toEqual([])
  })
})

describe('a lead stranded by a slot becoming a chore', () => {
  it('can still be vacated, though nobody new may be handed it', async () => {
    // The same escape hatch standing down from a crew has: a sitting changed under
    // whoever was leading it must not trap them there with no way off.
    const server = await build()
    await givenBurn()
    const admin = await givenAccount(['admin'])
    await addSlot(server, admin.cookie, { label: 'Dinner', at: '18:00' })
    await generate(server, admin.cookie)
    const ada = await givenAttending()
    const [meal] = (await listMeals(server, ada.cookie)).meals
    await send(server, 'PUT', `/api/meals/${meal.id}/lead`, ada.cookie, { account_id: ada.id })

    await db().update(mealTable).set({ kind: 'chore' }).where(eq(mealTable.id, meal.id))

    const handed = await send(server, 'PUT', `/api/meals/${meal.id}/lead`, ada.cookie, {
      account_id: ada.id,
    })
    expect(handed.statusCode).toBe(400)

    const vacated = await send(server, 'PUT', `/api/meals/${meal.id}/lead`, ada.cookie, {
      account_id: null,
    })
    expect(vacated.statusCode).toBe(200)
    expect(vacated.json().meal.lead).toBeNull()
  })
})

describe('telling somebody a meal role moved', () => {
  const setUp = async (deliver: Delivery) => {
    const server = await build(deliver)
    await givenBurn()
    const admin = await givenAccount(['admin'])
    await addSlot(server, admin.cookie, { label: 'Dinner', at: '18:00' })
    await generate(server, admin.cookie)
    const ada = await givenAttending('Ada')
    const [meal] = (await listMeals(server, ada.cookie)).meals

    return { server, admin, ada, meal }
  }

  it('tells the one handed the lead, and the one it came off', async () => {
    // Vacating is how every handover starts now, so being taken off has to be told
    // as well as being given it. A third person moves it, or the one who did it
    // would be the one not told — which is the next test.
    const deliver = vi.fn<Delivery>(() => Promise.resolve('sent'))
    const { server, admin, ada, meal } = await setUp(deliver)
    const bea = await givenAttending('Bea')
    await givenSubscribed(ada.id)
    await givenSubscribed(bea.id)
    await send(server, 'PUT', `/api/meals/${meal.id}/lead`, ada.cookie, { account_id: ada.id })
    deliver.mockClear()

    await send(server, 'PUT', `/api/meals/${meal.id}/lead`, admin.cookie, { account_id: bea.id })

    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(2))
    expect(messagesFrom(deliver).toSorted()).toEqual([
      'You are leading Dinner',
      'You are no longer leading Dinner',
    ])
  })

  it('says nothing to somebody who took it themselves', async () => {
    // Taking a job you want is the common case, and a notification for your own
    // click is what teaches people to ignore the channel.
    const deliver = vi.fn<Delivery>(() => Promise.resolve('sent'))
    const { server, ada, meal } = await setUp(deliver)
    await givenSubscribed(ada.id)

    await send(server, 'PUT', `/api/meals/${meal.id}/lead`, ada.cookie, { account_id: ada.id })

    expect(deliver).not.toHaveBeenCalled()
  })

  it('tells somebody put on a crew by anybody but themselves', async () => {
    const deliver = vi.fn<Delivery>(() => Promise.resolve('sent'))
    const { server, ada, meal } = await setUp(deliver)
    const bea = await givenAttending('Bea')
    await givenSubscribed(bea.id)

    await send(server, 'PUT', `/api/meals/${meal.id}/crew/helper`, ada.cookie, { account_id: bea.id })

    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1))
    expect(messagesFrom(deliver)).toEqual(['You are on helper for Dinner'])
  })

  it('says nothing the second time somebody is put on a crew', async () => {
    const deliver = vi.fn<Delivery>(() => Promise.resolve('sent'))
    const { server, ada, meal } = await setUp(deliver)
    const bea = await givenAttending('Bea')
    await givenSubscribed(bea.id)
    await send(server, 'PUT', `/api/meals/${meal.id}/crew/helper`, ada.cookie, { account_id: bea.id })
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1))
    deliver.mockClear()

    await send(server, 'PUT', `/api/meals/${meal.id}/crew/helper`, ada.cookie, { account_id: bea.id })

    expect(deliver).not.toHaveBeenCalled()
  })

  it('says nothing when nobody was actually taken off', async () => {
    // Bea was never on it. Without the guard she is told she has been dropped from
    // something she never joined — which a second tab makes ordinary.
    const deliver = vi.fn<Delivery>(() => Promise.resolve('sent'))
    const { server, ada, meal } = await setUp(deliver)
    const bea = await givenAttending('Bea')
    await givenSubscribed(bea.id)

    await send(server, 'DELETE', `/api/meals/${meal.id}/crew/helper/${bea.id}`, ada.cookie)

    expect(deliver).not.toHaveBeenCalled()
  })

  it('tells somebody taken off a crew by anybody but themselves', async () => {
    const deliver = vi.fn<Delivery>(() => Promise.resolve('sent'))
    const { server, ada, meal } = await setUp(deliver)
    const bea = await givenAttending('Bea')
    await givenSubscribed(bea.id)
    await send(server, 'PUT', `/api/meals/${meal.id}/crew/helper`, bea.cookie, { account_id: bea.id })
    deliver.mockClear()

    await send(server, 'DELETE', `/api/meals/${meal.id}/crew/helper/${bea.id}`, ada.cookie)

    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1))
    expect(messagesFrom(deliver)).toEqual(['You are off helper for Dinner'])
  })
})

describe('changing a plan somebody else has just changed', () => {
  const setIdea = (server: FastifyInstance, cookie: string, id: string, version?: string) =>
    server.inject({
      method: 'PUT',
      url: `/api/meals/${id}/idea`,
      headers: { cookie, ...(version === undefined ? {} : { 'if-match': version }) },
      payload: { food_idea: 'Dahl' },
    })

  const givenOneMeal = async (server: FastifyInstance, cookie: string) => {
    await addSlot(server, cookie, { label: 'Supper', at: '19:00' })
    await generate(server, cookie)

    return (await listMeals(server, cookie)).meals[0].id
  }

  it('refuses one written against no version of the plan, and against an old one', async () => {
    const server = await build()
    await givenBurn()
    const admin = await givenAccount(['admin', 'member'])
    const first = await givenOneMeal(server, admin.cookie)

    const asTheySawIt = String(
      (await send(server, 'GET', `/api/events/${BURN}/meals`, admin.cookie)).headers.etag,
    )

    expect((await setIdea(server, admin.cookie, first)).statusCode).toBe(428)

    // The words above the table are part of the same representation, so rewriting
    // them moves the version an idea is written against. One page, one tag.
    expect(
      (
        await send(server, 'PATCH', `/api/events/${BURN}/meal-intro`, admin.cookie, {
          meal_intro_markdown: 'Bring a bowl',
        })
      ).statusCode,
    ).toBe(200)

    const refused = await setIdea(server, admin.cookie, first, asTheySawIt)
    expect(refused.statusCode).toBe(412)
    expect(refused.json().intro_markdown).toBe('Bring a bowl')
  })

  it('takes one written against the version it was handed', async () => {
    const server = await build()
    await givenBurn()
    const admin = await givenAccount(['admin', 'member'])
    const first = await givenOneMeal(server, admin.cookie)

    const current = String(
      (await send(server, 'GET', `/api/events/${BURN}/meals`, admin.cookie)).headers.etag,
    )

    expect((await setIdea(server, admin.cookie, first, current)).statusCode).toBe(200)
  })
})
