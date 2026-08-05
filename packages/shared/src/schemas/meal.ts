import { z } from 'zod'

import { mealSlotKinds } from '../enums.ts'
import { MAX_OPTION_LABEL, MAX_WELCOME_LENGTH } from '../limits.ts'
import { dateSchema, idSchema, nonEmptyText, timeSchema } from './common.ts'

/**
 * A template for one recurring sitting — `Lunch 13:00`, `Morning cleanup 9:00`.
 *
 * Set once per burn, and what generating fills the days from. It is not the meal:
 * renaming a slot leaves the meals it already made alone.
 */
export const mealSlotFields = z.object({
  id: idSchema,
  event_id: idSchema,
  order: z.int().min(0),
  label: nonEmptyText(MAX_OPTION_LABEL),
  at: timeSchema,
  kind: z.enum(mealSlotKinds),
})

export const mealSlotSchema = mealSlotFields
export type MealSlot = z.infer<typeof mealSlotSchema>

const personSchema = z.object({ account_id: idSchema, name: z.string().nullable() })

/**
 * One sitting — Monday's lunch, Saturday's dinner.
 *
 * A row of its own, so a single one can be postponed, dropped or added without the
 * others noticing. `kind` decides what the schedule draws for it and nothing else.
 */
export const mealFields = z.object({
  id: idSchema,
  event_id: idSchema,
  date: dateSchema,
  at: timeSchema,
  label: nonEmptyText(MAX_OPTION_LABEL),
  kind: z.enum(mealSlotKinds),
  /** The sheet's "Food idea?", whose own header says "Not needed". */
  food_idea: z.string().max(MAX_OPTION_LABEL),
})

/**
 * A meal as the page reads it: the row, plus who has signed up for what.
 *
 * The three are read-only here and belong to no request body — each has its own
 * route, because each is one person acting for themselves or handing something over.
 */
export const mealSchema = mealFields.extend({
  lead: personSchema.nullable(),
  helpers: z.array(personSchema),
  cleanup: z.array(personSchema),
})
export type Meal = z.infer<typeof mealSchema>

/**
 * Everything the Meal page draws, and what the schedule needs for its kitchen lane.
 *
 * `slots` as well as `meals`, so the page can tell "nobody has set this burn up" from
 * "set up, and not generated yet".
 */
export const mealsResponseSchema = z.object({
  intro_markdown: z.string(),
  slots: z.array(mealSlotSchema),
  meals: z.array(mealSchema),
})
export type MealsResponse = z.infer<typeof mealsResponseSchema>

export const mealResponseSchema = z.object({ meal: mealSchema })
export type MealResponse = z.infer<typeof mealResponseSchema>

const slotEditable = mealSlotFields.omit({ id: true, event_id: true, order: true })

/** Adding a slot. The order is the API's to assign — a caller has no view of the rest. */
export const mealSlotCreateSchema = slotEditable
  .extend({ kind: slotEditable.shape.kind.default('meal') })
  .strict()
export type MealSlotCreate = z.infer<typeof mealSlotCreateSchema>
export type MealSlotCreateInput = z.input<typeof mealSlotCreateSchema>

/** Editing one. Partial, and defaults-free so `.partial()` actually produces a partial. */
export const mealSlotUpdateSchema = slotEditable.partial().strict()
export type MealSlotUpdate = z.infer<typeof mealSlotUpdateSchema>

export const mealSlotsResponseSchema = z.object({ slots: z.array(mealSlotSchema) })
export type MealSlotsResponse = z.infer<typeof mealSlotsResponseSchema>

const mealEditable = mealFields.omit({ id: true, event_id: true, food_idea: true })

/** Adding a single meal the slots did not produce — a late supper, a second lunch. */
export const mealCreateSchema = mealEditable
  .extend({ kind: mealEditable.shape.kind.default('meal') })
  .strict()
export type MealCreate = z.infer<typeof mealCreateSchema>
export type MealCreateInput = z.input<typeof mealCreateSchema>

/** Postponing one, renaming it, or moving it to another day. */
export const mealUpdateSchema = mealEditable.partial().strict()
export type MealUpdate = z.infer<typeof mealUpdateSchema>

/** Taking a meal's lead, handing it to somebody, or vacating it. `null` vacates. */
export const mealLeadSchema = z.object({ account_id: idSchema.nullable() }).strict()
export type MealLead = z.infer<typeof mealLeadSchema>

/** A note on what to cook. Anyone may write it, and the lead is not bound by it. */
export const mealIdeaUpdateSchema = z.object({ food_idea: z.string().max(MAX_OPTION_LABEL) }).strict()
export type MealIdeaUpdate = z.infer<typeof mealIdeaUpdateSchema>

/** The words above the table, which any approved member may rewrite. */
export const mealIntroUpdateSchema = z
  .object({ meal_intro_markdown: z.string().max(MAX_WELCOME_LENGTH) })
  .strict()
export type MealIntroUpdate = z.infer<typeof mealIntroUpdateSchema>
