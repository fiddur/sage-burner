import { z } from 'zod'

import type { IdOrder } from './common.ts'

import { eventOptionKinds } from '../enums.ts'
import { MAX_OPTION_LABEL } from '../limits.ts'
import { idOrderSchema, idSchema, nonEmptyText } from './common.ts'

export const eventOptionSchema = z.object({
  id: idSchema,
  event_id: idSchema,
  kind: z.enum(eventOptionKinds),
  order: z.int().nonnegative(),
  label: nonEmptyText(MAX_OPTION_LABEL),
  capacity: z.int().positive().nullable(),
})

export type EventOption = z.infer<typeof eventOptionSchema>

export const eventOptionTakenSchema = eventOptionSchema.extend({ taken: z.int().nonnegative() })
export type EventOptionTaken = z.infer<typeof eventOptionTakenSchema>

export const eventOptionResponseSchema = z.object({ option: eventOptionSchema })
export type EventOptionResponse = z.infer<typeof eventOptionResponseSchema>

export const eventOptionsResponseSchema = z.object({ options: z.array(eventOptionTakenSchema) })
export type EventOptionsResponse = z.infer<typeof eventOptionsResponseSchema>

export const eventOptionCreateSchema = eventOptionSchema
  .omit({ id: true, event_id: true, order: true })
  .extend({ capacity: eventOptionSchema.shape.capacity.default(null) })
  .strict()
export type EventOptionCreate = z.infer<typeof eventOptionCreateSchema>
export type EventOptionCreateInput = z.input<typeof eventOptionCreateSchema>

export const eventOptionUpdateSchema = eventOptionSchema
  .omit({ id: true, event_id: true, order: true, kind: true })
  .partial()
  .strict()
export type EventOptionUpdate = z.infer<typeof eventOptionUpdateSchema>

export const eventOptionOrderSchema = idOrderSchema
export type EventOptionOrder = IdOrder
