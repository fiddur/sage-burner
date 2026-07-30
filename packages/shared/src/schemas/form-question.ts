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
 * `agreement` implies `required`.
 *
 * The type exists precisely because submission is blocked when it is unticked,
 * so `{ type: 'agreement', required: false }` is self-contradictory — and it was
 * storable, leaving #14 to decide which half of the row to believe. Rejected at
 * the boundary instead, while there are no rows to migrate.
 *
 * A wrapper rather than a `.refine()` on `formQuestionSchema`, for the same
 * reason `withEventDateOrder` is one: a top-level refine produces a schema that
 * `.omit()` and `.partial()` refuse to operate on. It tolerates a partial body —
 * only a `type`/`required` pair that is present *and* contradictory is rejected —
 * so a PATCH carrying one of the two is settled by the handler against the
 * merged row.
 */
export const withAgreementRequired = <T extends z.ZodType<{ type?: string; required?: boolean }>>(
  schema: T,
) =>
  schema.refine((value) => value.type !== 'agreement' || value.required !== false, {
    message: 'an agreement question must be required',
    path: ['required'],
  })

/**
 * Creating a question. `id` and `event_id` come from the route, not the body.
 *
 * `order` is assigned by the server — a new question goes last. Letting a client
 * pick would make two organisers adding questions at once produce a collision
 * over something neither of them chose.
 */
export const formQuestionFields = formQuestionSchema.omit({ id: true, event_id: true, order: true }).extend({
  // `.nullable()` does not make a key optional, so omitting these was a bare
  // `bad_request` naming no field — and `options` is a column no question type
  // consumes yet, so every caller was sending an explicit `null` for something
  // inert. The update path already omitted them, so the two halves of the editor
  // disagreed about whether they are fields you send.
  help_text: formQuestionSchema.shape.help_text.nullish().default(null),
  options: formQuestionSchema.shape.options.nullish().default(null),
})

export const formQuestionCreateSchema = withAgreementRequired(formQuestionFields)
export type FormQuestionCreate = z.infer<typeof formQuestionCreateSchema>
/** What a client may send: `help_text` and `options` are optional here. */
export type FormQuestionCreateInput = z.input<typeof formQuestionCreateSchema>

/**
 * Editing one. `order` is changed by the reorder endpoint, not here.
 *
 * Derived from the plain field list, **not** from `formQuestionFields` — that one
 * carries `.default(null)` on `help_text` and `options`, and `.partial()` does not
 * suppress a default in Zod 4. Built from it, `safeParse({ label: 'New' })`
 * returned `{ label: 'New', help_text: null, options: null }`, so editing a label
 * silently wiped the help text, and an empty body parsed to a non-empty object
 * that slipped past the no-op guard and wiped it too.
 *
 * Defaults belong on create, where "absent" genuinely means "use this". On a
 * PATCH, absent means "leave it alone", which is the opposite.
 */
export const formQuestionUpdateSchema = withAgreementRequired(
  formQuestionSchema.omit({ id: true, event_id: true, order: true }).partial(),
)
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
