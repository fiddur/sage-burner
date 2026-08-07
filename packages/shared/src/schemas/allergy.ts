import { z } from 'zod'

import { MAX_OPTION_LABEL } from '../limits.ts'
import { idSchema, nonEmptyText } from './common.ts'

/**
 * One thing somebody can say they cannot eat (#254).
 *
 * Rows rather than an enum, like the application's questions and a burn's lanes:
 * adding "Nuts" must never need a redeploy. **Global**, unlike `event_option` — what
 * somebody cannot eat is a fact about them, so a per-burn list would mean re-ticking
 * it every time.
 *
 * The list does not replace `allergies_notes`; that free text stays beside it as
 * "Other", because a vocabulary is never complete and the cost of it being wrong
 * here is somebody's dinner.
 */
export const allergyItemSchema = z.object({
  id: idSchema,
  /** Display position, ascending. */
  order: z.int().nonnegative(),
  label: nonEmptyText(MAX_OPTION_LABEL),
})

export type AllergyItem = z.infer<typeof allergyItemSchema>

export const allergyItemsResponseSchema = z.object({ items: z.array(allergyItemSchema) })
export type AllergyItemsResponse = z.infer<typeof allergyItemsResponseSchema>

/** `order` is the server's to assign, so it is not offered here. */
export const allergyItemCreateSchema = allergyItemSchema.omit({ id: true, order: true }).strict()
export type AllergyItemCreate = z.infer<typeof allergyItemCreateSchema>

export const allergyItemUpdateSchema = allergyItemCreateSchema.partial().strict()
export type AllergyItemUpdate = z.infer<typeof allergyItemUpdateSchema>

/**
 * The whole ordering, as ids. Every item exactly once — a partial list would
 * renumber some rows and leave others on stale positions.
 */
export const allergyItemOrderSchema = z.object({ ids: z.array(idSchema) }).strict()
export type AllergyItemOrder = z.infer<typeof allergyItemOrderSchema>
