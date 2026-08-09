import { z } from 'zod'

import type { IdOrder } from './common.ts'

import { formQuestionTypes, tickBoxRequired } from '../enums.ts'
import { MAX_NOTES, MAX_OPTION_LABEL, MAX_QUESTION_LABEL } from '../limits.ts'
import { idOrderSchema, idSchema, nonEmptyText, optionalText } from './common.ts'

/**
 * One question on the application form.
 *
 * These are rows, not code, and there is **one set** rather than one per event:
 * an application is to the community, not to a burn. Admins retune the
 * questions between burns, so adding, editing or reordering one must never
 * require a redeploy — and the web app must render whatever it is given rather
 * than knowing the questions.
 */
export const formQuestionSchema = z.object({
  id: idSchema,
  /** Display position, ascending. */
  order: z.int().nonnegative(),
  type: z.enum(formQuestionTypes),
  label: nonEmptyText(MAX_QUESTION_LABEL),
  help_text: optionalText(MAX_NOTES),
  /** Enforced server-side on submission, not merely in the browser. */
  required: z.boolean(),
  /**
   * Reserved for future select/radio types. Defined now so the column exists,
   * but no question type consumes it yet.
   */
  options: z.array(nonEmptyText(MAX_OPTION_LABEL)).nullable(),
})

export type FormQuestion = z.infer<typeof formQuestionSchema>

/**
 * `required` is not a free choice for the two tick-box types.
 *
 * - **`agreement` must be required.** The type exists precisely because
 *   submission is blocked when it is unticked, so
 *   `{ type: 'agreement', required: false }` is self-contradictory.
 * - **`checkbox` must not be required.** A checkbox always has an answer — `false`
 *   is one — so "must be present" is vacuous, and the only other reading of a
 *   required checkbox is "must be ticked", which is what `agreement` *is*. Two
 *   spellings of one rule is the ambiguity, so the second is rejected rather than
 *   left for a consumer to interpret.
 *
 * Both were storable, leaving #14 to decide what such a row means. Settled at the
 * boundary while there are no rows to migrate, and mirrored by CHECK constraints
 * in `db/schema.ts` for writes that never touch this schema.
 *
 * The rule itself is `tickBoxRequired` in `enums.ts` — it lives there because the
 * web app needs it at runtime and this module evaluates Zod at import. The two
 * functions below are the other two shapes of it: whether a given pair breaks the
 * rule, and the schema wrapper that applies it.
 */

/**
 * Whether a `type`/`required` pair contradicts the rule.
 *
 * Absent keys pass, because a pair is only decidable when both are known and the
 * partial update schema below is built from this — a PATCH body may legitimately
 * carry one of the two keys, and rejecting that would refuse every single-field
 * edit.
 *
 * It is therefore *not* the whole rule for an update. The PATCH handler decides a
 * lone key inside its `UPDATE` statement instead of re-checking a merged row here,
 * because a merged-row check either side of an `await` is a race.
 */
export const violatesTickBoxRules = (value: { type?: string; required?: boolean }): boolean => {
  if (value.type === undefined || value.required === undefined) return false
  const must = tickBoxRequired(value.type)

  return must !== undefined && value.required !== must
}

/**
 * The rule as a schema wrapper.
 *
 * A wrapper rather than a `.refine()` on `formQuestionSchema`, for the same reason
 * `withEventDateOrder` is one: a top-level refine produces a schema that `.omit()`
 * and `.partial()` refuse to operate on. It tolerates a partial body, since
 * `violatesTickBoxRules` passes an undecidable pair — so a PATCH carrying one of
 * the two keys is settled by the handler, not here.
 */
export const withTickBoxRules = <T extends z.ZodType<{ type?: string; required?: boolean }>>(schema: T) =>
  schema.refine((value) => !violatesTickBoxRules(value), {
    message: 'an agreement question must be required, and a checkbox question must not be',
    path: ['required'],
  })

/**
 * The field list for **creating** a question.
 *
 * Not for editing: `formQuestionUpdateSchema` below is deliberately built from
 * `formQuestionSchema` instead, and says why.
 *
 * `id` and `order` are the server's, not the body's: a new question goes last, and
 * letting a client pick a position would make two admins adding at once collide
 * over a number neither of them chose.
 *
 * `.strict()` on both schemas below, for the reason `eventCreateSchema` and
 * `eventUpdateSchema` give: an unrecognised key is a 400 rather than a silent
 * success. A stripped typo parses to `{}`, the handler answers 200 with the row
 * unchanged, and the editor renders "Saved." over a write that never happened —
 * and on create, `POST { …, order: 0 }` would 201 with the key quietly dropped.
 *
 * It narrows the contract as well as catching typos: a client that reads a
 * question, edits the object and sends the whole thing back gets a 400 on `id`
 * and `order`. That is intended — a PATCH should name what it changes.
 */
export const formQuestionFields = formQuestionSchema.omit({ id: true, order: true }).extend({
  // `.nullable()` does not make a key optional, so omitting these was a bare
  // `bad_request` naming no field — and `options` is a column no question type
  // consumes yet, so every caller was sending an explicit `null` for something
  // inert. A PATCH could always omit them, since every key there is optional, so
  // the two halves of the editor disagreed about whether they are fields you send.
  //
  // The defaults are why editing must not derive from this object: on create,
  // absent means "use this"; on a PATCH it means "leave it alone".
  help_text: formQuestionSchema.shape.help_text.nullish().default(null),
  options: formQuestionSchema.shape.options.nullish().default(null),
})

export const formQuestionCreateSchema = withTickBoxRules(formQuestionFields.strict())
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
export const formQuestionUpdateSchema = withTickBoxRules(
  formQuestionSchema.omit({ id: true, order: true }).partial().strict(),
)
export type FormQuestionUpdate = z.infer<typeof formQuestionUpdateSchema>

/** Reordering: the complete list of question ids. See `idOrderSchema`. */
export const formQuestionOrderSchema = idOrderSchema
export type FormQuestionOrder = IdOrder

export const formQuestionsResponseSchema = z.object({ questions: z.array(formQuestionSchema) })
export type FormQuestionsResponse = z.infer<typeof formQuestionsResponseSchema>

export const formQuestionResponseSchema = z.object({ question: formQuestionSchema })
export type FormQuestionResponse = z.infer<typeof formQuestionResponseSchema>
