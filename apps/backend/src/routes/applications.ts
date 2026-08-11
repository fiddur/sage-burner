import type {
  Application,
  ApplicationResponse,
  MyApplicationResponse,
  StoredAnswers,
} from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { answerProblems, apiRoutes, applicationCreateSchema, isTickBox } from '@sage-burner/shared'
import { desc, eq, inArray } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'

import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { isUniqueViolation } from '../db/errors.ts'
import { account, accountRole, application } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { questionsFor } from './questions.ts'

export interface ApplicationRouteDeps extends GuardDeps {
  now: () => Date
  notify?: (message: string) => Promise<unknown>
}

/**
 * Whom a rejected applicant is told to ask. Names and contact details of the admins, which every
 * approved member can already read on the Members page — this is the one thing an account with no
 * roles may read about somebody else, and it exists because a rejection with no recourse is a
 * door closing in silence (#476).
 */
const organisersFor = async (db: GuardDeps['db']) => {
  const admins = await db
    .select({ account_id: accountRole.account_id })
    .from(accountRole)
    .where(eq(accountRole.role, 'admin'))

  if (admins.length === 0) return []

  return await db
    .select({ account_id: account.id, name: account.name, contact: account.contact })
    .from(account)
    .where(
      inArray(
        account.id,
        admins.map((row) => row.account_id),
      ),
    )
    .orderBy(account.name)
}

export const registerApplicationRoutes = (
  app: FastifyInstance,
  { db, sessions, now, notify }: ApplicationRouteDeps,
) => {
  const { requireSignedIn } = createGuards({ db, sessions })

  app.get(apiRoutes.getMyApplication.fastify, { preHandler: requireSignedIn }, async (request, reply) => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    const [mine] = await db
      .select()
      .from(application)
      .where(eq(application.account_id, viewer.account_id))
      .orderBy(desc(application.submitted_at))
      .limit(1)

    return {
      mine: { application: mine ?? null, organisers: await organisersFor(db) },
    } satisfies MyApplicationResponse
  })

  app.post(apiRoutes.submitApplication.fastify, { preHandler: requireSignedIn }, async (request, reply) => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

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
      account_id: viewer.account_id,
      answers,
      status: 'pending',
      applicant_name: body.applicant_name,
      applicant_email: body.applicant_email,
      submitted_at: now().toISOString(),
      decided_at: null,
    } satisfies Application

    try {
      await db.insert(application).values(row)
    } catch (error) {
      if (isUniqueViolation(error, 'application.account_id')) return sendError(reply, 409)
      throw error
    }

    if (notify !== undefined) {
      void notify('Someone has applied to join.').catch((failure: unknown) => {
        request.log.error({ err: failure }, 'notifying admins of an application failed')
      })
    }

    return reply.code(201).send({ application: row } satisfies ApplicationResponse)
  })
}
