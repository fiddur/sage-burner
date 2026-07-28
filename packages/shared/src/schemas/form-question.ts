import { z } from 'zod'

import { formQuestionTypes } from '../enums.ts'
import { idSchema, optionalText, text } from './common.ts'

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
  label: text(500),
  help_text: optionalText(2000),
  /** Enforced server-side on submission, not merely in the browser. */
  required: z.boolean(),
  /**
   * Reserved for future select/radio types. Defined now so the column exists,
   * but no question type consumes it yet.
   */
  options: z.array(text(200)).nullable(),
})

export type FormQuestion = z.infer<typeof formQuestionSchema>
