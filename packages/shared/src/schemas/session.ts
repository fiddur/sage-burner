import { z } from 'zod'

import { placeColors } from '../enums.ts'
import { MAX_DESCRIPTION, MAX_OPTION_LABEL, MAX_TITLE } from '../limits.ts'
import { dateTimeSchema, idSchema, nonEmptyText, optionalText } from './common.ts'

type TimeSlot = { time_slot_start?: string | null; time_slot_end?: string | null }

const hasWholeSlot = (slot: TimeSlot) => {
  if (!('time_slot_start' in slot) || !('time_slot_end' in slot)) return true

  return (slot.time_slot_start == null) === (slot.time_slot_end == null)
}

const hasOrderedSlot = ({ time_slot_start, time_slot_end }: TimeSlot) =>
  time_slot_start == null || time_slot_end == null || Date.parse(time_slot_start) < Date.parse(time_slot_end)

export const hasValidTimeSlot = (slot: TimeSlot) => hasWholeSlot(slot) && hasOrderedSlot(slot)

export const withValidTimeSlot = <T extends z.ZodType<TimeSlot>>(schema: T) =>
  schema
    .refine(hasWholeSlot, {
      message: 'a time slot needs both a start and an end, or neither',
      path: ['time_slot_end'],
    })
    .refine(hasOrderedSlot, {
      message: 'time_slot_end must be after time_slot_start',
      path: ['time_slot_end'],
    })

export const sessionFields = z.object({
  id: idSchema,
  event_id: idSchema,
  title: nonEmptyText(MAX_TITLE),
  facilitator_account_id: idSchema.nullable(),
  description: z.string().max(MAX_DESCRIPTION),
  repeatable: z.boolean(),
  time_slot_start: dateTimeSchema.nullable(),
  time_slot_end: dateTimeSchema.nullable(),
  place_id: idSchema.nullable(),
})

export const sessionSchema = withValidTimeSlot(
  sessionFields.extend({
    withdrawn_at: dateTimeSchema.nullable(),
    helpers: z.array(z.object({ account_id: idSchema, name: z.string().nullable() })),
    supporters: z.array(
      z.object({ account_id: idSchema, name: z.string().nullable(), avatar: z.string().nullable() }),
    ),
    support_count: z.int().min(0),
    supported_by_me: z.boolean(),
    thread_id: idSchema.nullable(),
  }),
)

export type Session = z.infer<typeof sessionSchema>

export const publicSessionFields = sessionFields.pick({ id: true, title: true, description: true }).extend({
  time_slot_start: dateTimeSchema,
  time_slot_end: dateTimeSchema,
  location: optionalText(MAX_OPTION_LABEL),
  color: z.enum(placeColors).nullable(),
})

export const publicSessionSchema = withValidTimeSlot(publicSessionFields)

export type PublicSession = z.infer<typeof publicSessionSchema>

export const sessionsResponseSchema = z.object({ sessions: z.array(sessionSchema) })
export type SessionsResponse = z.infer<typeof sessionsResponseSchema>

export const sessionResponseSchema = z.object({ session: sessionSchema })
export type SessionResponse = z.infer<typeof sessionResponseSchema>

export const sessionCreateSchema = withValidTimeSlot(
  sessionFields
    .omit({ id: true, event_id: true })
    .extend({
      description: sessionFields.shape.description.default(''),
      time_slot_start: sessionFields.shape.time_slot_start.default(null),
      time_slot_end: sessionFields.shape.time_slot_end.default(null),
      place_id: sessionFields.shape.place_id.default(null),
      facilitator_account_id: sessionFields.shape.facilitator_account_id.default(null),
      repeatable: sessionFields.shape.repeatable.default(false),
    })
    .strict(),
)
export type SessionCreate = z.infer<typeof sessionCreateSchema>

export type SessionCreateInput = z.input<typeof sessionCreateSchema>

export const sessionUpdateSchema = withValidTimeSlot(
  sessionFields.omit({ id: true, event_id: true }).partial().strict(),
)
export type SessionUpdate = z.infer<typeof sessionUpdateSchema>
