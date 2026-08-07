import { z } from 'zod'

import { MAX_QUESTION_LABEL, MAX_WELCOME_LENGTH } from '../limits.ts'
import { idSchema, nonEmptyText } from './common.ts'
import { copyFromSchema } from './copy.ts'

/**
 * One question and its answer, for one burn (#28).
 *
 * The spreadsheet's Q&A tab: how to get there by public transport, what taking part
 * actually asks of you, what to bring. **Per burn**, like the places and the register
 * — the practical answers change with the site and the year — with a copy action,
 * because most of them do carry over.
 *
 * `question` is plain text, because it is a heading and the page renders it as one.
 * `answer` is markdown, like every longer field a member writes for other people to
 * read; `markdown.ts` escapes raw HTML rather than filtering it, which is what makes
 * a member author safe to have.
 */
export const faqFields = z.object({
  id: idSchema,
  event_id: idSchema,
  question: nonEmptyText(MAX_QUESTION_LABEL),
  /**
   * Empty is allowed and is not an oversight: a question nobody has answered yet is
   * worth having on the page, so somebody can. The page says so where it is blank.
   */
  answer: z.string().max(MAX_WELCOME_LENGTH),
  order: z.int().min(0),
  created_at: z.string(),
})

export const faqSchema = faqFields
export type FaqEntry = z.infer<typeof faqSchema>

export const faqResponseSchema = z.object({ entry: faqSchema })
export const faqListResponseSchema = z.object({ entries: z.array(faqSchema) })
export type FaqResponse = z.infer<typeof faqResponseSchema>
export type FaqListResponse = z.infer<typeof faqListResponseSchema>

/**
 * Asking a question. The answer may come later and from somebody else.
 *
 * `order` and `created_at` are the server's, and `event_id` is in the path. The
 * answer defaults to empty so adding a question is one field — which is the point:
 * the person with the question is rarely the person with the answer.
 */
export const faqCreateSchema = z
  .object({
    question: faqFields.shape.question,
    answer: faqFields.shape.answer.default(''),
  })
  .strict()
export type FaqCreate = z.infer<typeof faqCreateSchema>

/** What a client may send, as opposed to what the parsed result holds. */
export type FaqCreateInput = z.input<typeof faqCreateSchema>

/**
 * Editing either half. Both optional, and `.strict()` for the reason the others
 * give: an unrecognised key is a 400 rather than a dropped one.
 *
 * Derived from the fields rather than from the create schema, so `.partial()` really
 * is partial — `faqCreateSchema` carries a default on `answer`, and Zod 4 does not
 * suppress a default under `.partial()`. `leadRoleUpdateSchema` documents the trap.
 */
export const faqUpdateSchema = faqFields
  .omit({ id: true, event_id: true, order: true, created_at: true })
  .partial()
  .strict()
export type FaqUpdate = z.infer<typeof faqUpdateSchema>

/** Seeding this burn's questions from a previous burn's. */
export const faqCopySchema = copyFromSchema
export type FaqCopy = z.infer<typeof faqCopySchema>
