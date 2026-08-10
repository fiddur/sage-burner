import type { Application, ApplicationResponse, StoredAnswers } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { answerProblems, apiRoutes, applicationCreateSchema, isTickBox } from '@sage-burner/shared'
import { randomUUID } from 'node:crypto'

import type { Database } from '../db/index.ts'

import { application } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { questionsFor } from './questions.ts'

export interface ApplicationRouteDeps {
  db: Database
  now: () => Date
  notify?: (message: string) => Promise<unknown>
}

export const registerApplicationRoutes = (
  app: FastifyInstance,
  { db, now, notify }: ApplicationRouteDeps,
) => {
  app.post(apiRoutes.submitApplication.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(applicationCreateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const questions = await questionsFor(db)

    if (answerProblems(questions, body.answers).length > 0) {
      return sendError(reply, 400)
    }

    const asked = new Set(body.asked)
    if (Object.keys(body.answers).some((id) => !asked.has(id))) {
      return sendError(reply, 400)
    }

    const answers: StoredAnswers = questions
      .filter((question) => asked.has(question.id))
      .map((question) => ({
        question_id: question.id,
        label: question.label,
        type: question.type,
        value: body.answers[question.id] ?? (isTickBox(question.type) ? false : ''),
      }))

    const row = {
      id: randomUUID(),
      answers,
      status: 'pending',
      applicant_name: body.applicant_name,
      applicant_email: body.applicant_email,
      submitted_at: now().toISOString(),
      decided_at: null,
    } satisfies Application

    await db.insert(application).values(row)

    if (notify !== undefined) {
      void notify('Someone has applied to join.').catch((failure: unknown) => {
        request.log.error({ err: failure }, 'notifying admins of an application failed')
      })
    }

    return reply.code(201).send({ application: row } satisfies ApplicationResponse)
  })
}
