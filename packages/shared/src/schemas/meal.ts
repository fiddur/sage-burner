import { z } from 'zod'

import { mealSlotKinds } from '../enums.ts'
import { MAX_OPTION_LABEL, MAX_WELCOME_LENGTH } from '../limits.ts'
import { dateSchema, idSchema, nonEmptyText, timeSchema } from './common.ts'

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

export const mealFields = z.object({
  id: idSchema,
  event_id: idSchema,
  date: dateSchema,
  at: timeSchema,
  label: nonEmptyText(MAX_OPTION_LABEL),
  kind: z.enum(mealSlotKinds),
  food_idea: z.string().max(MAX_OPTION_LABEL),
})

export const mealSchema = mealFields.extend({
  lead: personSchema.nullable(),
  helpers: z.array(personSchema),
  cleanup: z.array(personSchema),
})
export type Meal = z.infer<typeof mealSchema>

export const mealsResponseSchema = z.object({
  intro_markdown: z.string(),
  slots: z.array(mealSlotSchema),
  meals: z.array(mealSchema),
})
export type MealsResponse = z.infer<typeof mealsResponseSchema>

export const mealResponseSchema = z.object({ meal: mealSchema })
export type MealResponse = z.infer<typeof mealResponseSchema>

const slotEditable = mealSlotFields.omit({ id: true, event_id: true, order: true })

export const mealSlotCreateSchema = slotEditable
  .extend({ kind: slotEditable.shape.kind.default('meal') })
  .strict()
export type MealSlotCreate = z.infer<typeof mealSlotCreateSchema>
export type MealSlotCreateInput = z.input<typeof mealSlotCreateSchema>

export const mealSlotUpdateSchema = slotEditable.partial().strict()
export type MealSlotUpdate = z.infer<typeof mealSlotUpdateSchema>

export const mealSlotsResponseSchema = z.object({ slots: z.array(mealSlotSchema) })
export type MealSlotsResponse = z.infer<typeof mealSlotsResponseSchema>

const mealEditable = mealFields.omit({ id: true, event_id: true, food_idea: true })

export const mealCreateSchema = mealEditable
  .extend({ kind: mealEditable.shape.kind.default('meal') })
  .strict()
export type MealCreate = z.infer<typeof mealCreateSchema>
export type MealCreateInput = z.input<typeof mealCreateSchema>

export const mealUpdateSchema = mealEditable.partial().strict()
export type MealUpdate = z.infer<typeof mealUpdateSchema>

export const mealLeadSchema = z.object({ account_id: idSchema.nullable() }).strict()
export type MealLead = z.infer<typeof mealLeadSchema>

export const mealIdeaUpdateSchema = z.object({ food_idea: z.string().max(MAX_OPTION_LABEL) }).strict()
export type MealIdeaUpdate = z.infer<typeof mealIdeaUpdateSchema>

export const mealIntroUpdateSchema = z
  .object({ meal_intro_markdown: z.string().max(MAX_WELCOME_LENGTH) })
  .strict()
export type MealIntroUpdate = z.infer<typeof mealIntroUpdateSchema>
