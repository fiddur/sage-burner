import type { FormQuestion, FormQuestionResponse, FormQuestionsResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import {
  apiRoutes,
  formQuestionCreateSchema,
  formQuestionOrderSchema,
  formQuestionTypes,
  formQuestionUpdateSchema,
  tickBoxRequired,
} from '@sage-burner/shared'
import { asc, eq, notInArray } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { Database } from '../db/index.ts'

import { nextOrder, reorder } from '../db/ordered.ts'
import { patchRow } from '../db/patch.ts'
import { formQuestion } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'

const tickBoxCondition = ({ type, required }: { type?: string; required?: boolean }) => {
  if (type !== undefined && required !== undefined) return undefined

  if (type !== undefined) {
    const must = tickBoxRequired(type)
    return must === undefined ? undefined : eq(formQuestion.required, must)
  }

  if (required !== undefined) {
    const conflicting = formQuestionTypes.filter((candidate) => {
      const must = tickBoxRequired(candidate)

      return must !== undefined && must !== required
    })

    return conflicting.length === 0 ? undefined : notInArray(formQuestion.type, conflicting)
  }

  return undefined
}

export const questionsFor = (db: Database): Promise<FormQuestion[]> =>
  db.select().from(formQuestion).orderBy(asc(formQuestion.order), asc(formQuestion.id))

export const registerQuestionRoutes = (app: FastifyInstance, { db }: { db: Database }) => {
  app.get(apiRoutes.getQuestions.fastify, async (_request, reply) => {
    void reply.header('cache-control', 'no-cache')

    return { questions: await questionsFor(db) } satisfies FormQuestionsResponse
  })

  app.post(apiRoutes.addQuestion.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(formQuestionCreateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const id = randomUUID()

    const order = db.transaction((tx) => {
      const next = nextOrder(tx, formQuestion)
      tx.insert(formQuestion)
        .values({ ...body, id, order: next })
        .run()

      return next
    })

    const row: FormQuestion = { ...body, id, order }

    return reply.code(201).send({ question: row } satisfies FormQuestionResponse)
  })

  app.patch<{ Params: { id: string } }>(apiRoutes.updateQuestion.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(formQuestionUpdateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const patched = await patchRow(
      db,
      formQuestion,
      eq(formQuestion.id, request.params.id),
      body,
      tickBoxCondition(body),
    )

    if (patched.kind !== 'ok') return sendError(reply, patched.kind === 'not_found' ? 404 : 400)

    return { question: patched.row } satisfies FormQuestionResponse
  })

  app.delete<{ Params: { id: string } }>(apiRoutes.deleteQuestion.fastify, async (request, reply) => {
    void noStore(reply)

    const deleted = await db
      .delete(formQuestion)
      .where(eq(formQuestion.id, request.params.id))
      .returning({ id: formQuestion.id })

    if (deleted.length === 0) return sendError(reply, 404)

    return reply.code(204).send()
  })

  app.put(apiRoutes.reorderQuestions.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(formQuestionOrderSchema, request)
    if (body === undefined) return sendError(reply, 400)

    if (reorder(db, formQuestion, await questionsFor(db), body.ids) === 'mismatch') {
      return sendError(reply, 400)
    }

    return { questions: await questionsFor(db) } satisfies FormQuestionsResponse
  })
}
