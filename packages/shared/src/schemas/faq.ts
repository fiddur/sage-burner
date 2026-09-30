import { z } from 'zod'

import { MAX_FAQ_ANSWER, MAX_FAQ_QUESTION } from '../limits.ts'
import { idSchema, nonEmptyText } from './common.ts'
import { copyFromSchema } from './copy.ts'

export const faqFields = z.object({
  id: idSchema,
  event_id: idSchema,
  question: nonEmptyText(MAX_FAQ_QUESTION),
  answer: z.string().max(MAX_FAQ_ANSWER),
  order: z.int().min(0),
  author_account_id: idSchema.nullable(),
  created_at: z.string(),
})

export const faqSchema = faqFields
export type FaqRow = z.infer<typeof faqSchema>

export const faqEntrySchema = faqFields.extend({
  author_name: z.string().nullable(),
  thread_id: idSchema.nullable(),
})
export type FaqEntry = z.infer<typeof faqEntrySchema>

export const faqResponseSchema = z.object({ entry: faqEntrySchema })
export const faqListResponseSchema = z.object({ entries: z.array(faqEntrySchema) })
export type FaqResponse = z.infer<typeof faqResponseSchema>
export type FaqListResponse = z.infer<typeof faqListResponseSchema>

export const faqCreateSchema = z
  .object({
    question: faqFields.shape.question,
    answer: faqFields.shape.answer.default(''),
  })
  .strict()
export type FaqCreate = z.infer<typeof faqCreateSchema>

export type FaqCreateInput = z.input<typeof faqCreateSchema>

export const faqUpdateSchema = faqFields
  .omit({ id: true, event_id: true, order: true, author_account_id: true, created_at: true })
  .partial()
  .strict()
export type FaqUpdate = z.infer<typeof faqUpdateSchema>

export const faqCopySchema = copyFromSchema
export type FaqCopy = z.infer<typeof faqCopySchema>
