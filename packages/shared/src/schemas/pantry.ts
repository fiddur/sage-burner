import { z } from 'zod'

import { pantryKinds, stockLevels } from '../enums.ts'
import { MAX_OPTION_LABEL, MAX_UNIT, MAX_WHERE } from '../limits.ts'
import { allergyTagSchema } from './allergy.ts'
import { dateTimeSchema, idSchema, nonEmptyText } from './common.ts'
import { supporterSchema } from './thread.ts'

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
  where: z.string().trim().max(MAX_WHERE),
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
    where: pantryFields.where.default(''),
    allergy_item_ids: z.array(idSchema).default([]),
  })
  .strict()
export type PantryCreate = z.infer<typeof pantryCreateSchema>
export type PantryCreateInput = z.input<typeof pantryCreateSchema>

export const pantryUpdateSchema = z
  .object({ ...pantryFields, allergy_item_ids: z.array(idSchema) })
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
