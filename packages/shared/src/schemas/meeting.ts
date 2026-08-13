import { z } from 'zod'

import { MAX_DECIDED_NOTE, MAX_MEETING_LINK, MAX_NOTES, MAX_POST, MAX_TITLE } from '../limits.ts'
import { dateTimeSchema, idSchema, nonEmptyText, optionalText } from './common.ts'

export const meetingPointSchema = z.object({
  id: idSchema,
  event_id: idSchema,
  author_account_id: idSchema.nullable(),
  title: nonEmptyText(MAX_TITLE),
  body: z.string().trim().max(MAX_POST),
  decision: z.string().trim().max(MAX_POST).nullable(),
  decided_note: z.string().trim().max(MAX_DECIDED_NOTE).nullable(),
  created_at: dateTimeSchema,
})
export type MeetingPoint = z.infer<typeof meetingPointSchema>

export const meetingPointEntrySchema = meetingPointSchema.extend({
  author_name: z.string().nullable(),
  thread_id: idSchema.nullable(),
})
export type MeetingPointEntry = z.infer<typeof meetingPointEntrySchema>

export const meetingPointsResponseSchema = z.object({ points: z.array(meetingPointEntrySchema) })
export type MeetingPointsResponse = z.infer<typeof meetingPointsResponseSchema>

export const meetingPointResponseSchema = z.object({ point: meetingPointEntrySchema })
export type MeetingPointResponse = z.infer<typeof meetingPointResponseSchema>

export const meetingPointCreateSchema = meetingPointSchema
  .pick({ title: true, body: true })
  .extend({ body: meetingPointSchema.shape.body.default('') })
  .strict()
export type MeetingPointCreate = z.infer<typeof meetingPointCreateSchema>
export type MeetingPointCreateInput = z.input<typeof meetingPointCreateSchema>

export const meetingPointUpdateSchema = meetingPointSchema
  .pick({ title: true, body: true })
  .partial()
  .strict()
export type MeetingPointUpdate = z.infer<typeof meetingPointUpdateSchema>

/**
 * Clearing the decision reopens the point, so `null` is a value somebody sends rather than a
 * field they leave out — `.strict()` on a partial would let a typo mean "reopen it".
 */
export const decisionSchema = z
  .object({
    decision: z.string().trim().max(MAX_POST).nullable(),
    decided_note: optionalText(MAX_DECIDED_NOTE).default(null),
  })
  .strict()
  .transform(({ decision, decided_note }) => ({
    decision: decision === null || decision === '' ? null : decision,
    decided_note,
  }))
export type Decision = z.infer<typeof decisionSchema>
export type DecisionInput = z.input<typeof decisionSchema>

export const meetingSchema = z.object({
  id: idSchema,
  event_id: idSchema,
  title: nonEmptyText(MAX_TITLE),
  starts_at: dateTimeSchema,
  ends_at: dateTimeSchema.nullable(),
  link: z.string().trim().max(MAX_MEETING_LINK).nullable(),
  notes: z.string().trim().max(MAX_NOTES),
  created_at: dateTimeSchema,
})
export type Meeting = z.infer<typeof meetingSchema>

export const meetingsResponseSchema = z.object({ meetings: z.array(meetingSchema) })
export type MeetingsResponse = z.infer<typeof meetingsResponseSchema>

export const meetingResponseSchema = z.object({ meeting: meetingSchema })
export type MeetingResponse = z.infer<typeof meetingResponseSchema>

const withValidRun = <T extends { starts_at: string; ends_at?: string | null }>(schema: z.ZodType<T>) =>
  schema.refine((value) => value.ends_at == null || Date.parse(value.ends_at) > Date.parse(value.starts_at), {
    message: 'a meeting cannot end before it starts',
    path: ['ends_at'],
  })

export const meetingCreateSchema = withValidRun(
  meetingSchema
    .pick({ title: true, starts_at: true, ends_at: true, link: true, notes: true })
    .extend({
      ends_at: meetingSchema.shape.ends_at.default(null),
      link: optionalText(MAX_MEETING_LINK).default(null),
      notes: meetingSchema.shape.notes.default(''),
    })
    .strict(),
)
export type MeetingCreate = z.infer<typeof meetingCreateSchema>
export type MeetingCreateInput = z.input<typeof meetingCreateSchema>

export const meetingUpdateSchema = withValidRun(
  meetingSchema
    .pick({ title: true, starts_at: true, ends_at: true, link: true, notes: true })
    .extend({ link: optionalText(MAX_MEETING_LINK).default(null) })
    .strict(),
)
export type MeetingUpdate = z.infer<typeof meetingUpdateSchema>
export type MeetingUpdateInput = z.input<typeof meetingUpdateSchema>

/**
 * What a token-holding calendar client is told about a meeting. An allowlist, like
 * `publicSessionFields`: `schemas.test.ts` pins the key set, so a column added to `meeting`
 * reaches the feed only when somebody names it here.
 */
export const publicMeetingFields = meetingSchema
  .pick({ id: true, title: true, link: true })
  .extend({ starts_at: dateTimeSchema, ends_at: dateTimeSchema })
export const publicMeetingSchema = z.object(publicMeetingFields.shape).strict()
export type PublicMeeting = z.infer<typeof publicMeetingSchema>
