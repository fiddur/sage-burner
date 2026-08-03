import type { Application, ApplicationResponse, StoredAnswers } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { answerProblems, applicationCreateSchema, errorResponse, isTickBox } from '@sage-burner/shared'
import { randomUUID } from 'node:crypto'

import type { Database } from '../db/index.ts'

import { application } from '../db/schema.ts'
import { noStore } from '../http.ts'
import { questionsFor } from './questions.ts'

export interface ApplicationRouteDeps {
  db: Database
  now?: () => Date
}

/**
 * Applying to join — the one write in this app open to the public, since an
 * applicant has no account yet.
 *
 * Everything in the body is attacker-controlled, so the submitter names only
 * their answers: `.strict()` turns an attempt at `status` or `id` into a 400
 * rather than a silently dropped key, and the labels stored beside each answer
 * come from the question rows, so nobody can record a question that was never
 * asked.
 *
 * Not rate-limited here, consistent with login: throttling lives in the reverse
 * proxy where an operator can see it. Nothing here grants access, so the
 * realistic abuse is junk in the review list.
 */
export const registerApplicationRoutes = (
  app: FastifyInstance,
  { db, now = () => new Date() }: ApplicationRouteDeps,
) => {
  app.post('/api/applications', async (request, reply) => {
    void noStore(reply)

    const parsed = applicationCreateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

    const questions = await questionsFor(db)

    // Sharing these rules with the form buys agreement about the answers given
    // the same questions, not that a client-complete submission is
    // server-complete: the form ran them against the questions as they were when
    // the page loaded, and this is the side that decides.
    if (answerProblems(questions, parsed.data.answers).length > 0) {
      return reply.code(400).send(errorResponse('bad_request'))
    }

    // An answer to something the form says it never showed is a body disagreeing
    // with itself, and dropping it silently would lose what someone typed.
    const asked = new Set(parsed.data.asked)
    if (Object.keys(parsed.data.answers).some((id) => !asked.has(id))) {
      return reply.code(400).send(errorResponse('bad_request'))
    }

    // One entry per question *asked*, answered or not, so a reviewer can tell
    // "said no" from "was never asked" — which is why the form sends what it
    // showed rather than this trusting the current list. A question added while
    // someone was filling the page in would otherwise be stored against them as
    // an empty answer they never saw. `storedAnswerSchema` says why the wording
    // is snapshotted rather than referenced.
    const answers: StoredAnswers = questions
      .filter((question) => asked.has(question.id))
      .map((question) => ({
        question_id: question.id,
        label: question.label,
        type: question.type,
        value: parsed.data.answers[question.id] ?? (isTickBox(question.type) ? false : ''),
      }))

    const row = {
      id: randomUUID(),
      answers,
      status: 'pending',
      applicant_name: parsed.data.applicant_name,
      applicant_contact: parsed.data.applicant_contact,
      submitted_at: now().toISOString(),
      decided_at: null,
    } satisfies Application

    await db.insert(application).values(row)

    return reply.code(201).send({ application: row } satisfies ApplicationResponse)
  })
}
