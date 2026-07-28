import { z } from 'zod'

import { applicationStatuses } from '../enums.ts'
import { dateTimeSchema, idSchema, text } from './common.ts'

/**
 * One answer to one question. Text questions yield a string; `checkbox` and
 * `agreement` questions yield a boolean.
 */
export const answerSchema = z.union([z.string().max(10_000), z.boolean()])

/**
 * Answers keyed by `form_question.id`.
 *
 * `partialRecord`, not `record`: a plain `z.record` infers a non-optional index
 * signature, so `answers[question.id]` would type as `string | boolean` while
 * being `undefined` at runtime for every unanswered optional question — and the
 * dynamic form renderer and the admin review UI both index into exactly that.
 * Runtime behaviour is identical; this just stops the type lying.
 */
export const answersSchema = z.partialRecord(idSchema, answerSchema)

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
