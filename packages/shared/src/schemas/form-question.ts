import { z } from 'zod'

import { formQuestionTypes } from '../enums.ts'
import { idSchema, optionalText, nonEmptyText } from './common.ts'

/**
 * One question on an event's application form.
 *
 * These are rows, not code. Organisers retune the questions between every burn,
 * so adding, editing or reordering one must never require a redeploy — and the
 * web app must render whatever it is given rather than knowing the questions.
 */
export const formQuestionSchema = z.object({
  id: idSchema,
  event_id: idSchema,
  /** Display position, ascending. */
  order: z.int().nonnegative(),
  type: z.enum(formQuestionTypes),
  label: nonEmptyText(500),
  help_text: optionalText(2000),
  /** Enforced server-side on submission, not merely in the browser. */
  required: z.boolean(),
  /**
   * Reserved for future select/radio types. Defined now so the column exists,
   * but no question type consumes it yet.
   */
  options: z.array(nonEmptyText(200)).nullable(),
})

export type FormQuestion = z.infer<typeof formQuestionSchema>

/**
 * Creating a question. `id` and `event_id` come from the route, not the body.
 *
 * `order` is assigned by the server — a new question goes last. Letting a client
 * pick would make two organisers adding questions at once produce a collision
 * over something neither of them chose.
 */
export const formQuestionCreateSchema = formQuestionSchema.omit({
  id: true,
  event_id: true,
  order: true,
})
export type FormQuestionCreate = z.infer<typeof formQuestionCreateSchema>

/** Editing one. `order` is changed by the reorder endpoint, not here. */
export const formQuestionUpdateSchema = formQuestionCreateSchema.partial()
export type FormQuestionUpdate = z.infer<typeof formQuestionUpdateSchema>

/**
 * Reordering: the complete list of question ids, in the order wanted.
 *
 * The whole list rather than a move-this-one instruction, because the order is
 * what the organiser sees and dragging one question renumbers several. Sending
 * all of them makes the request describe the end state, so a lost or reordered
 * request cannot leave the form half-renumbered.
 */
export const formQuestionOrderSchema = z.object({ ids: z.array(idSchema) })
export type FormQuestionOrder = z.infer<typeof formQuestionOrderSchema>

export const formQuestionsResponseSchema = z.object({ questions: z.array(formQuestionSchema) })
export type FormQuestionsResponse = z.infer<typeof formQuestionsResponseSchema>

export const formQuestionResponseSchema = z.object({ question: formQuestionSchema })
export type FormQuestionResponse = z.infer<typeof formQuestionResponseSchema>
