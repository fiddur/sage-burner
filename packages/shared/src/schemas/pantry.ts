import { z } from 'zod'

import { pantryKinds, stockLevels } from '../enums.ts'
import { MAX_OPTION_LABEL, MAX_PANTRY_NOTE, MAX_SPOT, MAX_UNIT } from '../limits.ts'
import { allergyTagSchema } from './allergy.ts'
import { dateSchema, dateTimeSchema, idSchema, nonEmptyText } from './common.ts'
import { supporterSchema } from './thread.ts'

export const pantryPlaceSchema = z.object({
  id: idSchema,
  order: z.int().nonnegative(),
  name: nonEmptyText(MAX_OPTION_LABEL),
})
export type PantryPlace = z.infer<typeof pantryPlaceSchema>

export const pantryPlacesResponseSchema = z.object({ places: z.array(pantryPlaceSchema) })
export type PantryPlacesResponse = z.infer<typeof pantryPlacesResponseSchema>

export const pantryPlaceCreateSchema = pantryPlaceSchema.omit({ id: true, order: true }).strict()
export type PantryPlaceCreate = z.infer<typeof pantryPlaceCreateSchema>

export const pantryPlaceUpdateSchema = pantryPlaceCreateSchema.partial().strict()
export type PantryPlaceUpdate = z.infer<typeof pantryPlaceUpdateSchema>

export const pantryPlaceOrderSchema = z.object({ ids: z.array(idSchema) }).strict()
export type PantryPlaceOrder = z.infer<typeof pantryPlaceOrderSchema>

const spotField = z.string().trim().max(MAX_SPOT)

export const pantrySpotSchema = z.object({ spot: spotField }).strict()
export type PantrySpot = z.infer<typeof pantrySpotSchema>

export const pantryPlacingSchema = z.object({
  place_id: idSchema,
  name: nonEmptyText(MAX_OPTION_LABEL),
  spot: spotField,
})

const pantryPlacementSchema = z.object({ place_id: idSchema, spot: spotField.default('') }).strict()
export type PantryPlacement = z.infer<typeof pantryPlacementSchema>

export const pantryNeedMoreSchema = z.object({
  by: idSchema.nullable(),
  by_name: z.string().nullable(),
  at: dateTimeSchema,
})
export type PantryNeedMore = z.infer<typeof pantryNeedMoreSchema>

const pantryFields = {
  name: nonEmptyText(MAX_OPTION_LABEL),
  kind: z.enum(pantryKinds),
  unit: nonEmptyText(MAX_UNIT),
  note: z.string().trim().max(MAX_PANTRY_NOTE),
}

export const pantryItemSchema = z.object({
  id: idSchema,
  ...pantryFields,
  stock_level: z.enum(stockLevels).nullable(),
  stock_amount: z.number().nonnegative().nullable(),
  counted_by: idSchema.nullable(),
  counted_by_name: z.string().nullable(),
  counted_at: dateTimeSchema.nullable(),
  need_more: pantryNeedMoreSchema.nullable(),
  places: z.array(pantryPlacingSchema),
  withdrawn_at: dateTimeSchema.nullable(),
  created_at: dateTimeSchema,
  allergies: z.array(allergyTagSchema),
})
export type PantryItem = z.infer<typeof pantryItemSchema>

export const pantryListResponseSchema = z.object({ items: z.array(pantryItemSchema) })
export type PantryListResponse = z.infer<typeof pantryListResponseSchema>

export const pantryItemResponseSchema = z.object({ item: pantryItemSchema })
export type PantryItemResponse = z.infer<typeof pantryItemResponseSchema>

export const pantryCreateSchema = z
  .object({
    ...pantryFields,
    unit: pantryFields.unit.default('pcs'),
    note: pantryFields.note.default(''),
    allergy_item_ids: z.array(idSchema).default([]),
    places: z.array(pantryPlacementSchema).default([]),
  })
  .strict()
export type PantryCreate = z.infer<typeof pantryCreateSchema>
export type PantryCreateInput = z.input<typeof pantryCreateSchema>

export const pantryUpdateSchema = z
  .object({
    ...pantryFields,
    allergy_item_ids: z.array(idSchema),
    places: z.array(pantryPlacementSchema),
  })
  .partial()
  .strict()
export type PantryUpdate = z.infer<typeof pantryUpdateSchema>

export const pantryStockSchema = z
  .object({
    level: z.enum(stockLevels).nullable(),
    amount: z.number().nonnegative().nullable(),
  })
  .strict()
  .refine((stock) => stock.amount === null || stock.level === 'some', {
    error: 'an amount only says anything beside “some”',
  })
export type PantryStock = z.infer<typeof pantryStockSchema>

export const pantryHeartsSchema = z.object({
  count: z.int().min(0),
  people: z.array(supporterSchema),
  mine: z.boolean(),
})
export type PantryHearts = z.infer<typeof pantryHeartsSchema>

export const pantryBoughtSchema = z.object({
  by: idSchema.nullable(),
  by_name: z.string().nullable(),
  at: dateTimeSchema,
})
export type PantryBought = z.infer<typeof pantryBoughtSchema>

export const eventPantryItemSchema = pantryItemSchema.extend({
  hearts: pantryHeartsSchema,
  bought: pantryBoughtSchema.nullable(),
})
export type EventPantryItem = z.infer<typeof eventPantryItemSchema>

export const eventPantryResponseSchema = z.object({ items: z.array(eventPantryItemSchema) })
export type EventPantryResponse = z.infer<typeof eventPantryResponseSchema>

export const specialBuyLineSchema = z.object({
  id: idSchema,
  amount: z.number().nonnegative().nullable(),
  meal_label: z.string(),
  date: dateSchema,
  event_name: z.string(),
})
export type SpecialBuyLine = z.infer<typeof specialBuyLineSchema>

export const specialBuySchema = z.object({
  name: nonEmptyText(MAX_OPTION_LABEL),
  unit: nonEmptyText(MAX_UNIT),
  sittings: z.int().min(1),
  sample: z.object({
    meal_label: z.string(),
    date: dateSchema,
    event_name: z.string(),
  }),
  lines: z.array(specialBuyLineSchema),
})
export type SpecialBuy = z.infer<typeof specialBuySchema>

export const specialBuysResponseSchema = z.object({ buys: z.array(specialBuySchema) })
export type SpecialBuysResponse = z.infer<typeof specialBuysResponseSchema>

export const specialBuyAdoptSchema = z
  .object({
    name: nonEmptyText(MAX_OPTION_LABEL),
    unit: nonEmptyText(MAX_UNIT),
    amounts: z.record(idSchema, z.number().nonnegative().nullable()).default({}),
  })
  .strict()
export type SpecialBuyAdopt = z.infer<typeof specialBuyAdoptSchema>

export const specialBuyAdoptedSchema = z.object({ adopted: z.int().min(0) })
export type SpecialBuyAdopted = z.infer<typeof specialBuyAdoptedSchema>
