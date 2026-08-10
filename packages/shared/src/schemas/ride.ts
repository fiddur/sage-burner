import { z } from 'zod'

import { rideKinds } from '../enums.ts'
import { MAX_NOTES, MAX_RIDE_PLACE } from '../limits.ts'
import { idSchema, nonEmptyText } from './common.ts'

export const rideSchema = z.object({
  id: idSchema,
  event_id: idSchema,
  account_id: idSchema,
  kind: z.enum(rideKinds),
  from: nonEmptyText(MAX_RIDE_PLACE),
  when: nonEmptyText(MAX_RIDE_PLACE),
  seats: z.int().nonnegative(),
  notes: z.string().max(MAX_NOTES),
  created_at: z.string(),
})

export type Ride = z.infer<typeof rideSchema>

export const rideEntrySchema = rideSchema.extend({
  name: z.string().nullable(),
  contact: z.string().nullable(),
})

export type RideEntry = z.infer<typeof rideEntrySchema>

export const ridesResponseSchema = z.object({ rides: z.array(rideEntrySchema) })
export type RidesResponse = z.infer<typeof ridesResponseSchema>

export const rideCreateSchema = rideSchema
  .omit({ id: true, event_id: true, account_id: true, created_at: true })
  .strict()

export type RideCreate = z.infer<typeof rideCreateSchema>

export const rideUpdateSchema = rideCreateSchema.partial().strict()
export type RideUpdate = z.infer<typeof rideUpdateSchema>
