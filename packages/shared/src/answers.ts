import type { SubmittedAnswers } from './schemas/application.ts'
import type { FormQuestion } from './schemas/form-question.ts'

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

export type AnswerProblemReason = 'missing' | 'unchecked' | 'wrong_type' | 'unknown'

export interface AnswerProblem {
  question_id: string
  reason: AnswerProblemReason
}

/**
 * Whether a question is answered by ticking rather than writing.
 *
 * One definition, because three consumers need the same answer and they are in
 * different packages: this module deciding what a valid answer looks like, the
 * submission route deciding what an unanswered question stores, and the form
 * deciding which control to render. Written out in each, they drift — which is
 * what `tickBoxRequired` was collapsed to fix one PR ago.
 */
export const isTickBox = (type: FormQuestion['type']) => type === 'checkbox' || type === 'agreement'

/**
 * Every problem, in question order, with unknown ids last.
 *
 * All of them rather than the first, because the form marks them together —
 * returning one would walk an applicant through their mistakes a submission at
 * a time.
 */
export const answerProblems = (questions: FormQuestion[], answers: SubmittedAnswers): AnswerProblem[] => {
  const problems: AnswerProblem[] = []

  for (const question of questions) {
    const answer = answers[question.id]

    if (isTickBox(question.type)) {
      // Absent means unticked: a checkbox that was never touched is simply not
      // submitted by a browser. Treating absent as an error would reject every
      // form with an untouched optional box, and treating it as ticked would let
      // an applicant skip an agreement by omitting the key.
      if (answer !== undefined && typeof answer !== 'boolean') {
        problems.push({ question_id: question.id, reason: 'wrong_type' })
        continue
      }
      if (question.type === 'agreement' && answer !== true) {
        problems.push({ question_id: question.id, reason: 'unchecked' })
      }
      continue
    }

    if (answer !== undefined && typeof answer !== 'string') {
      problems.push({ question_id: question.id, reason: 'wrong_type' })
      continue
    }
    // Trimmed, so `required` means "said something" rather than "sent the key".
    if (question.required && (answer === undefined || answer.trim() === '')) {
      problems.push({ question_id: question.id, reason: 'missing' })
    }
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
