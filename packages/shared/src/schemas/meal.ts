import { z } from 'zod'

import { mealSlotKinds } from '../enums.ts'
import { MAX_OPTION_LABEL, MAX_WELCOME_LENGTH } from '../limits.ts'
import { dateSchema, idSchema, nonEmptyText, timeSchema } from './common.ts'

/**
 * One recurring slot in the kitchen's day — `Lunch 13:00`, `Morning cleanup 9:00`.
 *
 * The burn's shape rather than a member's business, so these are admin's to set and
 * are normally set once.
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
 * One sitting: a slot on a date, with whoever has signed up for it.
 *
 * No id, because there is no row — `(slot_id, date)` is a meal's whole identity, and
 * both halves already exist. The label, time and kind are copied from the slot so a
 * caller has everything the table shows without a second lookup.
 */
export const mealSchema = z.object({
  slot_id: idSchema,
  date: dateSchema,
  label: z.string(),
  at: timeSchema,
  kind: z.enum(mealSlotKinds),
  /** The sheet's "Food idea?", whose own header says "Not needed". Empty until somebody has one. */
  food_idea: z.string().max(MAX_OPTION_LABEL),
  lead: personSchema.nullable(),
  helpers: z.array(personSchema),
  cleanup: z.array(personSchema),
})
export type Meal = z.infer<typeof mealSchema>

/**
 * Everything the Meal page draws, and what the schedule needs for its kitchen lane.
 *
 * `slots` as well as `meals`, because a burn with slots configured but no days left
 * in it reads differently from one nobody has set up — the page can say which. It is
 * also what tells the schedule whether to draw a kitchen at all.
 */
export const mealsResponseSchema = z.object({
  intro_markdown: z.string(),
  slots: z.array(mealSlotSchema),
  meals: z.array(mealSchema),
})
export type MealsResponse = z.infer<typeof mealsResponseSchema>

const slotEditable = mealSlotFields.omit({ id: true, event_id: true })

/** Adding a slot. The order is the API's to assign — a caller has no view of the rest. */
export const mealSlotCreateSchema = slotEditable
  .omit({ order: true })
  .extend({ kind: slotEditable.shape.kind.default('meal') })
  .strict()
export type MealSlotCreate = z.infer<typeof mealSlotCreateSchema>
export type MealSlotCreateInput = z.input<typeof mealSlotCreateSchema>

/** Editing one. Partial, and defaults-free so `.partial()` actually produces a partial. */
export const mealSlotUpdateSchema = slotEditable.omit({ order: true }).partial().strict()
export type MealSlotUpdate = z.infer<typeof mealSlotUpdateSchema>

export const mealSlotsResponseSchema = z.object({ slots: z.array(mealSlotSchema) })
export type MealSlotsResponse = z.infer<typeof mealSlotsResponseSchema>

/** Taking the lead on a sitting, handing it to somebody, or vacating it. `null` vacates. */
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

export const mealResponseSchema = z.object({ meal: mealSchema })
export type MealResponse = z.infer<typeof mealResponseSchema>
