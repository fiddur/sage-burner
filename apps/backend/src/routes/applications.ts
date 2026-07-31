import type { Application, ApplicationResponse, StoredAnswers } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { answerProblems, applicationCreateSchema, errorResponse, isTickBox } from '@sage-burner/shared'
import { asc } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { Database } from '../db/index.ts'

import { application, formQuestion } from '../db/schema.ts'
import { noStore } from '../http.ts'

export interface ApplicationRouteDeps {
  db: Database
  now?: () => Date
}

/**
 * Applying to join.
 *
 * The one write in this app open to the public, which is the whole point — an
 * applicant has no account yet. Everything in the body is therefore
 * attacker-controlled, and two things follow:
 *
 * - The submitter names only their answers. `status`, `id` and the timestamps
 *   are the server's, and `.strict()` turns an attempt at any of them into a 400
 *   rather than a silently dropped key.
 * - The questions are re-read here rather than taken from the request. The
 *   labels stored beside each answer come from those rows, so a submitter cannot
 *   record a question that was never asked.
 *
 * Not rate-limited in the app, consistent with the login route: throttling lives
 * in the reverse proxy, where an operator can see and tune it, and the README's
 * deployment section says so. The realistic abuse here is someone filling the
 * organisers' review list with junk, which is a nuisance to delete rather than a
 * way in — nothing here grants access, and approval is a deliberate human act.
 */
export const registerApplicationRoutes = (
  app: FastifyInstance,
  { db, now = () => new Date() }: ApplicationRouteDeps,
) => {
  app.post('/api/applications', async (request, reply) => {
    void noStore(reply)

    const parsed = applicationCreateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

    // Read in display order, so the stored answers read top to bottom the way the
    // applicant filled them in rather than in whatever order the client's object
    // happened to serialise.
    const questions = await db.select().from(formQuestion).orderBy(asc(formQuestion.order))

    // The same function the form uses to mark its fields, so a submission the
    // browser called complete cannot be one the server calls a 400.
    if (answerProblems(questions, parsed.data.answers).length > 0) {
      return reply.code(400).send(errorResponse('bad_request'))
    }

    // One entry per question asked, answered or not: a reviewer has to be able to
    // tell "said no" from "was never asked", and an absent tick box means the
    // first. The label is snapshotted here — see `storedAnswerSchema` for why a
    // reference alone does not survive the questions being edited.
    const answers: StoredAnswers = questions.map((question) => ({
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
