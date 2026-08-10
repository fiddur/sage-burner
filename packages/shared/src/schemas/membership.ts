import { z } from 'zod'

import { paymentStatuses } from '../enums.ts'
import { MAX_CONTACT, MAX_INTRODUCTION, MAX_NOTES, MAX_OPTION_LABEL, MAX_PERSON_NAME } from '../limits.ts'
import { emailSchema } from './auth.ts'
import { dateSchema, dateTimeSchema, idSchema, nonEmptyText, optionalText } from './common.ts'
import { eventFields } from './event.ts'

type Stay = { arrival_date?: string | null; departure_date?: string | null }

const staysInOrder = ({ arrival_date, departure_date }: Stay) =>
  arrival_date == null || departure_date == null || arrival_date <= departure_date

export const withStayOrder = <T extends z.ZodType<Stay>>(schema: T) =>
  schema.refine(staysInOrder, {
    message: 'departure_date must not be before arrival_date',
    path: ['departure_date'],
  })

export const profileFields = z.object({
  name: nonEmptyText(MAX_PERSON_NAME),
  contact: nonEmptyText(MAX_CONTACT),
  allergies_notes: optionalText(MAX_NOTES),
  allergy_item_ids: z.array(idSchema),
  introduction: optionalText(MAX_INTRODUCTION),
})

export const profileSchema = profileFields.extend({
  account_id: idSchema,
  email: emailSchema,
  name: profileFields.shape.name.nullable(),
  contact: profileFields.shape.contact.nullable(),
})

export const profileResponseSchema = z.object({ profile: profileSchema })

export const profileUpdateSchema = profileFields.partial().strict()

export const attendanceFields = z.object({
  id: idSchema,
  event_id: idSchema,
  account_id: idSchema,
  joined_at: dateTimeSchema,
  arrival_date: dateSchema.nullable(),
  departure_date: dateSchema.nullable(),
  lodging_option_id: idSchema.nullable(),
  helping_option_ids: z.array(idSchema),
  helping_other: optionalText(MAX_OPTION_LABEL),
  notes: optionalText(MAX_NOTES),
  payment_status: z.enum(paymentStatuses),
  payment_date: dateSchema.nullable(),
})

export const attendanceSchema = withStayOrder(attendanceFields)

export const attendanceUpdateSchema = withStayOrder(
  attendanceFields
    .omit({
      id: true,
      event_id: true,
      account_id: true,
      joined_at: true,
      payment_status: true,
      payment_date: true,
    })
    .partial()
    .strict(),
)

export type Profile = z.infer<typeof profileSchema>
export type ProfileResponse = z.infer<typeof profileResponseSchema>
export type Attendance = z.infer<typeof attendanceSchema>
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>
export type AttendanceUpdate = z.infer<typeof attendanceUpdateSchema>

export const attendanceCreateSchema = z.object({ account_id: idSchema }).strict()

export const helperSchema = z.object({ account_id: idSchema }).strict()
export type Helper = z.infer<typeof helperSchema>

export const myBurnSchema = z.object({
  event: eventFields.pick({
    id: true,
    name: true,
    slug: true,
    start_date: true,
    end_date: true,
    start_time: true,
    end_time: true,
  }),
  attendance: attendanceSchema.nullable(),
})

export const myBurnsResponseSchema = z.object({
  coming: z.array(myBurnSchema),
  past: z.array(myBurnSchema),
})

export const eventAttendeesResponseSchema = z.object({
  attendees: z.array(
    z.object({
      account_id: idSchema,
      name: z.string().nullable(),
      avatar: z.string().nullable(),
    }),
  ),
})

export type AttendanceCreate = z.infer<typeof attendanceCreateSchema>
export type MyBurn = z.infer<typeof myBurnSchema>
export type MyBurnsResponse = z.infer<typeof myBurnsResponseSchema>
export type EventAttendeesResponse = z.infer<typeof eventAttendeesResponseSchema>

export const rosterEntrySchema = attendanceFields.extend({
  email: emailSchema,
  name: profileFields.shape.name.nullable(),
  avatar: z.string().nullable(),
  contact: profileFields.shape.contact.nullable(),
  allergies_notes: profileFields.shape.allergies_notes,
  allergy_items: z.array(z.string()),
  lodging: optionalText(MAX_OPTION_LABEL),
  helping: optionalText(MAX_NOTES),
  waiting: z.boolean(),
})

export const rosterResponseSchema = z.object({
  event: eventFields.pick({ id: true, name: true, member_cap: true }).nullable(),
  entries: z.array(rosterEntrySchema),
})

export const memberRosterEntrySchema = rosterEntrySchema.omit({
  email: true,
  payment_date: true,
})

export const memberRosterResponseSchema = z.object({
  event: eventFields
    .pick({
      id: true,
      name: true,
      member_cap: true,
      payment_info_markdown: true,
      transfer_info_markdown: true,
    })
    .nullable(),
  entries: z.array(memberRosterEntrySchema),
})

export const paymentUpdateSchema = z
  .object({ payment_status: z.enum(paymentStatuses) })
  .partial()
  .strict()

export const placeTransferSchema = z.object({ to_account_id: idSchema }).strict()

export type PlaceTransfer = z.infer<typeof placeTransferSchema>

export type RosterEntry = z.infer<typeof rosterEntrySchema>
export type RosterResponse = z.infer<typeof rosterResponseSchema>
export type MemberRosterEntry = z.infer<typeof memberRosterEntrySchema>
export type MemberRosterResponse = z.infer<typeof memberRosterResponseSchema>
export type PaymentUpdate = z.infer<typeof paymentUpdateSchema>
