import type { SubmittedAnswers } from './schemas/application.ts'
import type { FormQuestion } from './schemas/form-question.ts'

import { tickBoxRequired } from './enums.ts'

/**
 * Whether a set of answers satisfies the questions asked.
 *
 * Type-only imports, so this module pulls in no Zod and the browser can run it.
 * That matters because both sides need the same verdict: the server refuses a
 * submission that fails, and the form marks the fields that caused it. Written
 * twice they drift, and the drift shows up as a form that says everything is
 * fine against a server that says 400.
 *
 * The server is still the authority — this is a pure function over data the
 * server re-reads, not a check the client can skip past.
 */

/**
 * Length limits, here rather than inline in the schemas so the form can enforce
 * the same numbers.
 *
 * They were only in the Zod schemas at first, which meant the API refused a
 * 10,001-character answer that the form had happily accepted — the drift this
 * module exists to prevent, reached through the one field where a long answer is
 * actually expected.
 */
export const MAX_ANSWER_LENGTH = 10_000
export const MAX_APPLICANT_NAME_LENGTH = 200
export const MAX_APPLICANT_CONTACT_LENGTH = 500

export type AnswerProblemReason = 'missing' | 'unchecked' | 'wrong_type' | 'unknown' | 'too_long'

export interface AnswerProblem {
  question_id: string
  reason: AnswerProblemReason
}

/**
 * Whether a question is answered by ticking rather than writing.
 *
 * Derived from `tickBoxRequired` rather than listing the types again: it returns
 * a value for exactly the two tick-box types and `undefined` otherwise, so the
 * vocabulary lives in one place. A fifth question type is then added once.
 *
 * Three consumers need this answer and they are in different packages — this
 * module deciding what a valid answer looks like, the submission route deciding
 * what an unanswered question stores, and the form deciding which control to
 * render — which is exactly the spread that let the copies of `tickBoxRequired`
 * drift before they were collapsed.
 */
export const isTickBox = (type: FormQuestion['type']) => tickBoxRequired(type) !== undefined

/**
 * Every problem, in question order, with unknown ids last.
 *
 * All of them rather than the first, because the form marks them together —
 * returning one would walk an applicant through their mistakes a submission at
 * a time.
 */
/**
 * What is wrong with one answer, or `undefined` when nothing is.
 *
 * Split out from the loop below when adding the length rule tipped it past the
 * complexity limit — which was a fair signal rather than a lint to appease: this
 * is the rule for a single question, and the loop is now only the iteration.
 */
const problemWith = (
  question: FormQuestion,
  answer: string | boolean | undefined,
): AnswerProblemReason | undefined => {
  if (isTickBox(question.type)) {
    // Absent means unticked: a checkbox that was never touched is simply not
    // submitted by a browser. Treating absent as an error would reject every
    // form with an untouched optional box, and treating it as ticked would let
    // an applicant skip an agreement by omitting the key.
    if (answer !== undefined && typeof answer !== 'boolean') return 'wrong_type'
    if (question.type === 'agreement' && answer !== true) return 'unchecked'

    return undefined
  }

  if (answer !== undefined && typeof answer !== 'string') return 'wrong_type'
  if (answer !== undefined && answer.length > MAX_ANSWER_LENGTH) return 'too_long'
  // Trimmed, so `required` means "said something" rather than "sent the key".
  if (question.required && (answer === undefined || answer.trim() === '')) return 'missing'

  return undefined
}

export const answerProblems = (questions: FormQuestion[], answers: SubmittedAnswers): AnswerProblem[] => {
  const problems: AnswerProblem[] = []

  for (const question of questions) {
    const reason = problemWith(question, answers[question.id])
    if (reason !== undefined) problems.push({ question_id: question.id, reason })
  }

  const asked = new Set(questions.map((question) => question.id))
  for (const id of Object.keys(answers)) {
    // An id that was deleted between loading the form and submitting it, or one
    // that was invented. Storing it would put a key in `answers` that nothing can
    // ever label.
    if (!asked.has(id)) problems.push({ question_id: id, reason: 'unknown' })
  }

  return problems
}
