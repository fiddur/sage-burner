import type { SubmittedAnswers } from './schemas/application.ts'
import type { FormQuestion } from './schemas/form-question.ts'

import { tickBoxRequired } from './enums.ts'
import { MAX_EMAIL, MAX_PERSON_NAME } from './limits.ts'

export const MAX_ANSWER_LENGTH = 10_000
export const MAX_APPLICANT_NAME_LENGTH = MAX_PERSON_NAME
export const MAX_APPLICANT_EMAIL_LENGTH = MAX_EMAIL

export const looksLikeEmail = (value: string): boolean => /^[^\s@]+@[^\s@.]+\.[^\s@]+$/u.test(value.trim())

export const MAX_ASKED_QUESTIONS = 500

export type AnswerProblemReason = 'missing' | 'unchecked' | 'wrong_type' | 'unknown' | 'too_long'

export interface AnswerProblem {
  question_id: string
  reason: AnswerProblemReason
}

export const isTickBox = (type: FormQuestion['type']) => tickBoxRequired(type) !== undefined

const problemWith = (
  question: FormQuestion,
  answer: string | boolean | undefined,
): AnswerProblemReason | undefined => {
  if (isTickBox(question.type)) {
    if (answer !== undefined && typeof answer !== 'boolean') return 'wrong_type'
    if (question.type === 'agreement' && answer !== true) return 'unchecked'

    return undefined
  }

  if (answer !== undefined && typeof answer !== 'string') return 'wrong_type'
  if (answer !== undefined && answer.length > MAX_ANSWER_LENGTH) return 'too_long'
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
    if (!asked.has(id)) problems.push({ question_id: id, reason: 'unknown' })
  }

  return problems
}
