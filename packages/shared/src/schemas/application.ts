import { z } from 'zod'

import { applicationStatuses } from '../enums.ts'
import { dateTimeSchema, idSchema, text } from './common.ts'

/**
 * One answer to one question. Text questions yield a string; `checkbox` and
 * `agreement` questions yield a boolean.
 */
export const answerSchema = z.union([z.string().max(10_000), z.boolean()])

/** Answers keyed by `form_question.id`. */
export const answersSchema = z.record(idSchema, answerSchema)

export const applicationSchema = z.object({
  id: idSchema,
  event_id: idSchema,
  answers: answersSchema,
  status: z.enum(applicationStatuses),
  applicant_name: text(200),
  applicant_contact: text(500),
  submitted_at: dateTimeSchema,
  /** Set when an admin approves or rejects; null while pending. */
  decided_at: dateTimeSchema.nullable(),
})

export type Answer = z.infer<typeof answerSchema>
export type Answers = z.infer<typeof answersSchema>
export type Application = z.infer<typeof applicationSchema>
