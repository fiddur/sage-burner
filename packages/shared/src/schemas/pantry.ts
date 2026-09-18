import { z } from 'zod'

import { pantryKinds, stockLevels } from '../enums.ts'
import { MAX_OPTION_LABEL, MAX_UNIT, MAX_WHERE } from '../limits.ts'
import { dateTimeSchema, idSchema, nonEmptyText } from './common.ts'

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
  withdrawn_at: dateTimeSchema.nullable(),
  created_at: dateTimeSchema,
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
  })
  .strict()
export type PantryCreate = z.infer<typeof pantryCreateSchema>
export type PantryCreateInput = z.input<typeof pantryCreateSchema>

export const pantryUpdateSchema = z.object(pantryFields).partial().strict()
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
