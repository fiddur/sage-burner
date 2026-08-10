import { z } from 'zod'

import { MAX_OPTION_LABEL } from '../limits.ts'
import { idSchema, nonEmptyText } from './common.ts'

export const allergyItemSchema = z.object({
  id: idSchema,
  order: z.int().nonnegative(),
  label: nonEmptyText(MAX_OPTION_LABEL),
})

export type AllergyItem = z.infer<typeof allergyItemSchema>

export const allergyItemsResponseSchema = z.object({ items: z.array(allergyItemSchema) })
export type AllergyItemsResponse = z.infer<typeof allergyItemsResponseSchema>

export const allergyItemCreateSchema = allergyItemSchema.omit({ id: true, order: true }).strict()
export type AllergyItemCreate = z.infer<typeof allergyItemCreateSchema>

export const allergyItemUpdateSchema = allergyItemCreateSchema.partial().strict()
export type AllergyItemUpdate = z.infer<typeof allergyItemUpdateSchema>

export const allergyItemOrderSchema = z.object({ ids: z.array(idSchema) }).strict()
export type AllergyItemOrder = z.infer<typeof allergyItemOrderSchema>
