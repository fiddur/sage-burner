import { z } from 'zod'

import { MAX_LOCATION, MAX_TITLE, MAX_WELCOME_LENGTH } from '../limits.ts'
import { dateSchema, dateTimeSchema, idSchema, nonEmptyText, slugSchema, timeSchema } from './common.ts'

type DateRange = { start_date?: string; end_date?: string; start_time?: string; end_time?: string }

const hasOrderedDates = ({ start_date, end_date, start_time, end_time }: DateRange) => {
  if (start_date === undefined || end_date === undefined) return true
  if (start_date !== end_date) return start_date < end_date
  if (start_time === undefined || end_time === undefined) return true

  return start_time <= end_time
}

export const withEventDateOrder = <T extends z.ZodType<DateRange>>(schema: T) =>
  schema.refine(hasOrderedDates, {
    message: 'the burn must not end before it starts',
    path: ['end_date'],
  })

export const hasOrderedRange = (range: Required<DateRange>) => hasOrderedDates(range)

export const eventFields = z.object({
  id: idSchema,
  name: nonEmptyText(MAX_TITLE),
  slug: slugSchema,
  start_date: dateSchema,
  end_date: dateSchema,
  start_time: timeSchema,
  end_time: timeSchema,
  location: z.string().max(MAX_LOCATION),
  welcome_markdown: z.string().max(MAX_WELCOME_LENGTH),
  payment_info_markdown: z.string().max(MAX_WELCOME_LENGTH),
  transfer_info_markdown: z.string().max(MAX_WELCOME_LENGTH),
  member_cap: z.int().positive(),
  created_at: dateTimeSchema,
})

export const eventSchema = withEventDateOrder(eventFields)

export type Event = z.infer<typeof eventSchema>

export const DEFAULT_TRANSFER_INFO =
  'A paid member can transfer their membership to someone else. To transfer yours, ' +
  'contact the members on the waiting list and settle the payment between you. Then ' +
  'hand the place over from your own page.'

export const eventCreateSchema = withEventDateOrder(
  eventFields
    .omit({ id: true, created_at: true })
    .extend({
      location: eventFields.shape.location.default(''),
      welcome_markdown: eventFields.shape.welcome_markdown.default(''),
      payment_info_markdown: eventFields.shape.payment_info_markdown.default(''),
      transfer_info_markdown: eventFields.shape.transfer_info_markdown.default(DEFAULT_TRANSFER_INFO),
      start_time: eventFields.shape.start_time.default('00:00'),
      end_time: eventFields.shape.end_time.default('23:59'),
    })
    .strict(),
)
export type EventCreate = z.infer<typeof eventCreateSchema>

export type EventCreateInput = z.input<typeof eventCreateSchema>

export const eventUpdateSchema = withEventDateOrder(
  eventFields.omit({ id: true, created_at: true }).partial().strict(),
)
export type EventUpdate = z.infer<typeof eventUpdateSchema>

export const eventWelcomeUpdateSchema = eventFields.pick({ welcome_markdown: true }).strict()
export type EventWelcomeUpdate = z.infer<typeof eventWelcomeUpdateSchema>

export const eventResponseSchema = z.object({ event: eventFields })
export type EventResponse = z.infer<typeof eventResponseSchema>

export const eventsResponseSchema = z.object({ events: z.array(eventFields) })
export type EventsResponse = z.infer<typeof eventsResponseSchema>

export const activeEventResponseSchema = z.object({ event: eventFields.nullable() })
export type ActiveEventResponse = z.infer<typeof activeEventResponseSchema>

export const calendarFeedResponseSchema = z.object({ token: z.string() })

export type CalendarFeedResponse = z.infer<typeof calendarFeedResponseSchema>
