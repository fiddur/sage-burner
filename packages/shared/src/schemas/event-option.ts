import { z } from 'zod'

import { eventOptionKinds } from '../enums.ts'
import { idSchema, nonEmptyText } from './common.ts'

/**
 * One entry in a per-event list: somewhere to sleep, or something to help with.
 *
 * Rows rather than a shared enum, because the answer changes with the site and
 * the year — the same reasoning as the application questions and the places.
 * What is fixed is that there are exactly two kinds of list.
 */
export const eventOptionSchema = z.object({
  id: idSchema,
  event_id: idSchema,
  kind: z.enum(eventOptionKinds),
  /** Display position within its kind, ascending. */
  order: z.int().nonnegative(),
  label: nonEmptyText(200),
  /**
   * How many people fit, or null for no limit.
   *
   * Only lodging uses it — "Temple mattress: 9" — and null is the right answer
   * for "own tent" as much as for every helping-out entry.
   */
  capacity: z.int().positive().nullable(),
})

export type EventOption = z.infer<typeof eventOptionSchema>

export const eventOptionsResponseSchema = z.object({ options: z.array(eventOptionSchema) })
export type EventOptionsResponse = z.infer<typeof eventOptionsResponseSchema>

/** `id`, `event_id` and `order` are the server's to assign. */
export const eventOptionCreateSchema = eventOptionSchema
  .omit({ id: true, event_id: true, order: true })
  .extend({ capacity: eventOptionSchema.shape.capacity.default(null) })
  .strict()
export type EventOptionCreate = z.infer<typeof eventOptionCreateSchema>
export type EventOptionCreateInput = z.input<typeof eventOptionCreateSchema>

/** `kind` is not editable: moving an entry between lists is deleting and adding. */
export const eventOptionUpdateSchema = eventOptionSchema
  .omit({ id: true, event_id: true, order: true, kind: true })
  .partial()
  .strict()
export type EventOptionUpdate = z.infer<typeof eventOptionUpdateSchema>

/** The whole ordering for one kind, as ids. */
export const eventOptionOrderSchema = z.object({ ids: z.array(idSchema) }).strict()
export type EventOptionOrder = z.infer<typeof eventOptionOrderSchema>
