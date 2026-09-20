import type { SpecialBuy, SpecialBuyAdopted, SpecialBuyLine, SpecialBuysResponse } from '@sage-burner/shared'
import type { AnyColumn } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'

import { apiRoutes, specialBuyAdoptSchema, specialKey } from '@sage-burner/shared'
import { and, asc, eq, gte, inArray, isNull, sql } from 'drizzle-orm'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'

import { viewerFor } from '../auth/viewer.ts'
import { event, meal, mealIngredient, pantryItem } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { todayIso } from './events.ts'
import { noteIngredientsChanged } from './meals.ts'

export interface SpecialBuyDeps extends GuardDeps {
  now: () => Date
}

const written = (db: Database, today: string) =>
  db
    .select({
      id: mealIngredient.id,
      name: mealIngredient.name,
      unit: mealIngredient.unit,
      amount: mealIngredient.amount,
      meal_id: meal.id,
      meal_label: meal.label,
      date: meal.date,
      event_name: event.name,
    })
    .from(mealIngredient)
    .innerJoin(meal, eq(meal.id, mealIngredient.meal_id))
    .innerJoin(event, eq(event.id, meal.event_id))
    .where(and(isNull(mealIngredient.pantry_item_id), gte(event.end_date, today)))
    .orderBy(asc(meal.date), asc(meal.at), asc(meal.label))

interface Gathered {
  name: string
  unit: string
  sittings: Set<string>
  sample: SpecialBuy['sample']
  lines: SpecialBuyLine[]
}

const byCount = (one: SpecialBuy, other: SpecialBuy): number =>
  one.sittings === other.sittings
    ? one.name.toLowerCase().localeCompare(other.name.toLowerCase())
    : other.sittings - one.sittings

export const specialBuysFor = async (db: Database, today: string): Promise<SpecialBuy[]> => {
  const gathered = new Map<string, Gathered>()

  for (const row of await written(db, today)) {
    if (row.name === null || row.unit === null) continue

    const key = specialKey({ name: row.name, unit: row.unit })
    const so_far = gathered.get(key) ?? {
      name: row.name,
      unit: row.unit,
      sittings: new Set<string>(),
      sample: { meal_label: row.meal_label, date: row.date, event_name: row.event_name },
      lines: [],
    }

    so_far.sittings.add(row.meal_id)
    so_far.lines.push({
      id: row.id,
      amount: row.amount,
      meal_label: row.meal_label,
      date: row.date,
      event_name: row.event_name,
    })
    gathered.set(key, so_far)
  }

  return [...gathered.values()]
    .map((one) => ({
      name: one.name,
      unit: one.unit,
      sittings: one.sittings.size,
      sample: one.sample,
      lines: one.lines,
    }))
    .sort(byCount)
}

const same = (column: AnyColumn, written_as: string) =>
  sql`lower(trim(${column})) = ${written_as.trim().toLowerCase()}`

export const registerSpecialBuyRoutes = (app: FastifyInstance, { db, sessions, now }: SpecialBuyDeps) => {
  app.get(apiRoutes.getSpecialBuys.fastify, async (_request, reply) => {
    void noStore(reply)

    return { buys: await specialBuysFor(db, todayIso(now)) } satisfies SpecialBuysResponse
  })

  app.post<{ Params: { id: string } }>(apiRoutes.adoptSpecialBuy.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(specialBuyAdoptSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const [thing] = await db
      .select({ id: pantryItem.id, unit: pantryItem.unit, withdrawn_at: pantryItem.withdrawn_at })
      .from(pantryItem)
      .where(eq(pantryItem.id, request.params.id))
      .limit(1)

    if (thing === undefined || thing.withdrawn_at !== null) return sendError(reply, 404)

    const open = db
      .select({ id: meal.id })
      .from(meal)
      .innerJoin(event, eq(event.id, meal.event_id))
      .where(gte(event.end_date, todayIso(now)))

    const matching = await db
      .select({ id: mealIngredient.id })
      .from(mealIngredient)
      .where(
        and(
          isNull(mealIngredient.pantry_item_id),
          same(mealIngredient.name, body.name),
          same(mealIngredient.unit, body.unit),
          inArray(mealIngredient.meal_id, open),
        ),
      )

    const converting = new Set(matching.map((line) => line.id))
    const given = Object.entries(body.amounts)
    if (given.some(([id]) => !converting.has(id))) return sendError(reply, 400)

    const taken =
      converting.size === 0
        ? []
        : await db
            .update(mealIngredient)
            .set({ pantry_item_id: thing.id, name: null, unit: null })
            .where(inArray(mealIngredient.id, [...converting]))
            .returning({ meal_id: mealIngredient.meal_id })

    for (const [id, amount] of given) {
      await db.update(mealIngredient).set({ amount }).where(eq(mealIngredient.id, id))
    }

    const touched = [...new Set(taken.map((line) => line.meal_id))]

    if (touched.length > 0) {
      const viewer = await viewerFor(request, { db, sessions })
      const sittings = await db
        .select({ id: meal.id, event_id: meal.event_id, label: meal.label })
        .from(meal)
        .where(inArray(meal.id, touched))

      for (const sitting of sittings) {
        await noteIngredientsChanged(db, now(), sitting, viewer?.account_id)
      }
    }

    return { adopted: taken.length } satisfies SpecialBuyAdopted
  })
}
