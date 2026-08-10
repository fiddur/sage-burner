import { z } from 'zod'

import type { IdOrder } from './common.ts'

import { formQuestionTypes, tickBoxRequired } from '../enums.ts'
import { MAX_NOTES, MAX_OPTION_LABEL, MAX_QUESTION_LABEL } from '../limits.ts'
import { idOrderSchema, idSchema, nonEmptyText, optionalText } from './common.ts'

export const formQuestionSchema = z.object({
  id: idSchema,
  order: z.int().nonnegative(),
  type: z.enum(formQuestionTypes),
  label: nonEmptyText(MAX_QUESTION_LABEL),
  help_text: optionalText(MAX_NOTES),
  required: z.boolean(),
  options: z.array(nonEmptyText(MAX_OPTION_LABEL)).nullable(),
})

export type FormQuestion = z.infer<typeof formQuestionSchema>

export const violatesTickBoxRules = (value: { type?: string; required?: boolean }): boolean => {
  if (value.type === undefined || value.required === undefined) return false
  const must = tickBoxRequired(value.type)

  return must !== undefined && value.required !== must
}

export const withTickBoxRules = <T extends z.ZodType<{ type?: string; required?: boolean }>>(schema: T) =>
  schema.refine((value) => !violatesTickBoxRules(value), {
    message: 'an agreement question must be required, and a checkbox question must not be',
    path: ['required'],
  })

export const formQuestionFields = formQuestionSchema.omit({ id: true, order: true }).extend({
  // These defaults are why editing must not derive from this object: on create, absent means
  // "use this"; on a PATCH it means "leave it alone".
  help_text: formQuestionSchema.shape.help_text.nullish().default(null),
  options: formQuestionSchema.shape.options.nullish().default(null),
})

export const formQuestionCreateSchema = withTickBoxRules(formQuestionFields.strict())
export type FormQuestionCreate = z.infer<typeof formQuestionCreateSchema>
export type FormQuestionCreateInput = z.input<typeof formQuestionCreateSchema>

export const formQuestionUpdateSchema = withTickBoxRules(
  formQuestionSchema.omit({ id: true, order: true }).partial().strict(),
)
export type FormQuestionUpdate = z.infer<typeof formQuestionUpdateSchema>

export const formQuestionOrderSchema = idOrderSchema
export type FormQuestionOrder = IdOrder

export const formQuestionsResponseSchema = z.object({ questions: z.array(formQuestionSchema) })
export type FormQuestionsResponse = z.infer<typeof formQuestionsResponseSchema>

export const formQuestionResponseSchema = z.object({ question: formQuestionSchema })
export type FormQuestionResponse = z.infer<typeof formQuestionResponseSchema>
