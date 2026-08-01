import { z } from 'zod'

import { placeColors } from '../enums.ts'
import { idSchema, nonEmptyText } from './common.ts'

/**
 * Somewhere a dream can happen — the Temple, the Sauna, the Front Lawn.
 *
 * Rows rather than code for the same reason the application questions are:
 * the site changes between burns, and adding a place must never need a
 * redeploy. One central set, not one per event — the venue outlives the burn.
 *
 * The emoji and colour are not decoration. They are how a lane is identified at
 * a glance in the scheduling grid, and the colour is a name from a fixed
 * vocabulary so the grid stays legible whoever picks it.
 */
export const placeSchema = z.object({
  id: idSchema,
  /** Display position, ascending. */
  order: z.int().nonnegative(),
  name: nonEmptyText(100),
  /**
   * Bounded rather than validated as an emoji. A ZWJ sequence is several code
   * points and the set grows with every Unicode release, so a regex here would
   * reject valid input on a schedule nobody can fix without a deploy.
   */
  emoji: nonEmptyText(16),
  color: z.enum(placeColors),
})

export type Place = z.infer<typeof placeSchema>

export const placesResponseSchema = z.object({ places: z.array(placeSchema) })
export type PlacesResponse = z.infer<typeof placesResponseSchema>

/** `order` is the server's to assign, so it is not offered here. */
export const placeCreateSchema = placeSchema.omit({ id: true, order: true }).strict()
export type PlaceCreate = z.infer<typeof placeCreateSchema>

export const placeUpdateSchema = placeCreateSchema.partial().strict()
export type PlaceUpdate = z.infer<typeof placeUpdateSchema>

/**
 * The whole ordering, as ids. Every place exactly once — a partial list would
 * renumber some rows and leave others on stale positions.
 */
export const placeOrderSchema = z.object({ ids: z.array(idSchema) }).strict()
export type PlaceOrder = z.infer<typeof placeOrderSchema>
