import { z } from 'zod'

import type { IdOrder } from './common.ts'

import { placeColors } from '../enums.ts'
import { MAX_EMOJI, MAX_PLACE_NAME } from '../limits.ts'
import { idOrderSchema, idSchema, nonEmptyText } from './common.ts'
import { copyFromSchema } from './copy.ts'

export const placeSchema = z.object({
  id: idSchema,
  event_id: idSchema,
  order: z.int().nonnegative(),
  name: nonEmptyText(MAX_PLACE_NAME),
  emoji: nonEmptyText(MAX_EMOJI),
  color: z.enum(placeColors),
})

export type Place = z.infer<typeof placeSchema>

export const placesResponseSchema = z.object({ places: z.array(placeSchema) })
export type PlacesResponse = z.infer<typeof placesResponseSchema>

export const placeCreateSchema = placeSchema.omit({ id: true, event_id: true, order: true }).strict()
export type PlaceCreate = z.infer<typeof placeCreateSchema>

export const placeUpdateSchema = placeCreateSchema.partial().strict()
export type PlaceUpdate = z.infer<typeof placeUpdateSchema>

export const placeOrderSchema = idOrderSchema
export type PlaceOrder = IdOrder

export const placeCopySchema = copyFromSchema
