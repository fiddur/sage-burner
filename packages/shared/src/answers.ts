import type { SubmittedAnswers } from './schemas/application.ts'
import type { FormQuestion } from './schemas/form-question.ts'

import { tickBoxRequired } from './enums.ts'

/**
 * Whether a set of answers satisfies the questions asked.
 *
 * Type-only imports, so this module pulls in no Zod and the browser can run it.
 * Both sides need the same verdict — the server refuses a submission on it, the
 * form marks its fields with it — and written twice they drift into a form that
 * says everything is fine against an API that answers 400.
 */

export const MAX_ANSWER_LENGTH = 10_000
export const MAX_APPLICANT_NAME_LENGTH = 200
export const MAX_APPLICANT_CONTACT_LENGTH = 500

/**
 * How many questions one submission may claim it was shown.
 *
 * Every other attacker-controlled field on the public application route carries a
 * ceiling, and this one is a list. Fastify's 1 MB body limit already caps it near
 * 26k ids, so this is not availability — it is the ceiling being stated where the
 * others are rather than inherited from a default somewhere else. Far above any
 * form a person would fill in: the admin editor lists them on one page.
 */
export const MAX_ASKED_QUESTIONS = 500

export type AnswerProblemReason = 'missing' | 'unchecked' | 'wrong_type' | 'unknown' | 'too_long'

export interface AnswerProblem {
  question_id: string
  reason: AnswerProblemReason
}

/** Derived rather than listing the types again, so a fifth is added in one place. */
export const isTickBox = (type: FormQuestion['type']) => tickBoxRequired(type) !== undefined

const problemWith = (
  question: FormQuestion,
  answer: string | boolean | undefined,
): AnswerProblemReason | undefined => {
  if (isTickBox(question.type)) {
    // A browser omits an untouched box entirely, so absent means unticked.
    // Reading it as ticked would let an applicant skip an agreement by leaving
    // the key out.
    if (answer !== undefined && typeof answer !== 'boolean') return 'wrong_type'
    if (question.type === 'agreement' && answer !== true) return 'unchecked'

    return undefined
  }

  if (answer !== undefined && typeof answer !== 'string') return 'wrong_type'
  if (answer !== undefined && answer.length > MAX_ANSWER_LENGTH) return 'too_long'
  if (question.required && (answer === undefined || answer.trim() === '')) return 'missing'

  return undefined
}

/** Every problem, so the form can mark them together rather than one per submission. */
export const answerProblems = (questions: FormQuestion[], answers: SubmittedAnswers): AnswerProblem[] => {
  const problems: AnswerProblem[] = []

  for (const question of questions) {
    const reason = problemWith(question, answers[question.id])
    if (reason !== undefined) problems.push({ question_id: question.id, reason })
  }

  const asked = new Set(questions.map((question) => question.id))
  for (const id of Object.keys(answers)) {
    if (!asked.has(id)) problems.push({ question_id: id, reason: 'unknown' })
  }

  return problems
}
