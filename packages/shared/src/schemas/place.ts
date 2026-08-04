import { z } from 'zod'

import { placeColors } from '../enums.ts'
import { MAX_EMOJI, MAX_PLACE_NAME } from '../limits.ts'
import { idSchema, nonEmptyText } from './common.ts'
import { copyFromSchema } from './copy.ts'

/**
 * Somewhere a dream can happen — the Temple, the Sauna, the Front Lawn.
 *
 * Rows rather than code for the same reason the application questions are:
 * the site changes between burns, and adding a place must never need a
 * redeploy. **Per event**, seeded from a previous burn: the venue outlives the burn
 * but the set in use does not — some spots are summer-only, and an event tent is
 * there some years and not others (#156).
 *
 * The emoji and colour are not decoration. They are how a lane is identified at
 * a glance in the scheduling grid, and the colour is a name from a fixed
 * vocabulary so the grid stays legible whoever picks it.
 */
export const placeSchema = z.object({
  id: idSchema,
  event_id: idSchema,
  /** Display position, ascending. Within the burn — two burns each start at 0. */
  order: z.int().nonnegative(),
  name: nonEmptyText(MAX_PLACE_NAME),
  /**
   * Bounded rather than validated as an emoji. A ZWJ sequence is several code
   * points and the set grows with every Unicode release, so a regex here would
   * reject valid input on a schedule nobody can fix without a deploy.
   */
  emoji: nonEmptyText(MAX_EMOJI),
  color: z.enum(placeColors),
})

export type Place = z.infer<typeof placeSchema>

export const placesResponseSchema = z.object({ places: z.array(placeSchema) })
export type PlacesResponse = z.infer<typeof placesResponseSchema>

/**
 * `order` is the server's to assign and `event_id` comes from the path, so neither
 * is offered here — a body naming a burn would be a second, disagreeing opinion
 * about which burn's grid this lane is on.
 */
export const placeCreateSchema = placeSchema.omit({ id: true, event_id: true, order: true }).strict()
export type PlaceCreate = z.infer<typeof placeCreateSchema>

export const placeUpdateSchema = placeCreateSchema.partial().strict()
export type PlaceUpdate = z.infer<typeof placeUpdateSchema>

/**
 * The whole ordering, as ids. Every place exactly once — a partial list would
 * renumber some rows and leave others on stale positions.
 */
export const placeOrderSchema = z.object({ ids: z.array(idSchema) }).strict()
export type PlaceOrder = z.infer<typeof placeOrderSchema>

/**
 * Seeding a burn's lanes from a previous burn's.
 *
 * The lanes themselves, never the dreams standing in them — which burn's Temple a
 * dream was in is a fact about that burn. `copy.ts`'s body and source list, shared
 * with the lead-roles register.
 */
export const placeCopySchema = copyFromSchema
