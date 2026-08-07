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

/**
 * The tick-box rule as SQL, for a PATCH carrying only one of the two keys — or
 * `undefined` when the body cannot break it.
 *
 * A merged-row check either side of an `await` is check-then-act. Two PATCHes
 * arriving in one event-loop turn — `{ type: 'checkbox' }` and `{ required: true }`
 * against `(text, false)` — each read before either writes, so both pass their own
 * check, both write, and the row lands on `(checkbox, required=1)`. The database
 * CHECK then rejects the second UPDATE and the caller gets a 500. Deciding it
 * inside the statement makes it atomic.
 *
 * `stayOrderCondition` in `routes/profile.ts` is the same shape for the same
 * reason. `events.ts` and `sessions.ts` answer it the other way — reading the row
 * and checking the merge — because their rules came to span fields a SQL string
 * comparison cannot judge soundly.
 *
 * With **both** keys present the body settles it alone and the schema refine has
 * already rejected a contradictory pair, so there is nothing to evaluate here.
 */
const tickBoxCondition = ({ type, required }: { type?: string; required?: boolean }) => {
  if (type !== undefined && required !== undefined) return undefined

  if (type !== undefined) {
    const must = tickBoxRequired(type)
    return must === undefined ? undefined : eq(formQuestion.required, must)
  }

  // Derived from the vocabulary and the rule, not restated. Hardcoding "true
  // conflicts with checkbox, false with agreement" is correct only while there are
  // exactly two tick-box types — add a third and create would reject it (the refine
  // reads `tickBoxRequired`) while this branch let a PATCH through to the CHECK,
  // which is the drift this design exists to prevent.
  if (required !== undefined) {
    const conflicting = formQuestionTypes.filter((candidate) => {
      const must = tickBoxRequired(candidate)

      return must !== undefined && must !== required
    })

    return conflicting.length === 0 ? undefined : notInArray(formQuestion.type, conflicting)
  }

  return undefined
}

/**
 * The application form's questions — one central set, not one per event.
 *
 * Rows, not code: admins retune them between burns, so adding, editing or
 * reordering one must never need a redeploy, and the web app renders whatever it
 * is handed rather than knowing the questions.
 *
 * Reads are public, because the application form is. Every write is admin-only.
 */
export const questionsFor = (db: Database): Promise<FormQuestion[]> =>
  db.select().from(formQuestion).orderBy(asc(formQuestion.order), asc(formQuestion.id))

export const registerQuestionRoutes = (app: FastifyInstance, { db }: { db: Database }) => {
  app.get(apiRoutes.getQuestions.fastify, async (_request, reply) => {
    // Same reasoning as the active event: public, but an edit has to show up
    // without waiting out a heuristic freshness window.
    void reply.header('cache-control', 'no-cache')

    return { questions: await questionsFor(db) } satisfies FormQuestionsResponse
  })

  app.post(apiRoutes.addQuestion.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(formQuestionCreateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const id = randomUUID()

    // One transaction, because otherwise "the server assigns `order`" is not true —
    // `nextOrder` says why. The order is returned rather than read back off a row
    // from inside the callback: that worked only because `drizzle-orm/node-sqlite` is
    // synchronous, and on an async driver the insert would still be right while the
    // 201 body reported `order: 0`.
    //
    // No scope: there is one application form, so its questions number as one list.
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

    // No merged-row check in JS. A PATCH can break the tick-box rule with a
    // single field from either direction, and the schema cannot decide a lone key
    // — but a read-then-check here is a race (see `tickBoxCondition`), and a JS
    // fail-fast would also pre-empt the statement in every non-racing case, so
    // nothing would exercise the condition that does the real work. It goes to
    // `patchRow` as the condition the write is only allowed under.
    const patched = await patchRow(
      db,
      formQuestion,
      eq(formQuestion.id, request.params.id),
      body,
      tickBoxCondition(body),
    )

    // `refused` is the tick-box condition saying no, which is the caller's mistake
    // about this row rather than a missing one.
    if (patched.kind !== 'ok') return sendError(reply, patched.kind === 'not_found' ? 404 : 400)

    return { question: patched.row } satisfies FormQuestionResponse
  })

  app.delete<{ Params: { id: string } }>(apiRoutes.deleteQuestion.fastify, async (request, reply) => {
    void noStore(reply)

    // A hard delete, and safe to keep as one: `application.answers` stores each
    // question's wording beside the answer rather than a bare reference, so a
    // submitted application stays fully readable after the question it answered
    // is gone. That is also why editing a question does not rewrite history —
    // past applicants keep the wording they were actually shown.
    //
    // One statement: `.returning()` gives the 404 from the write itself, and
    // closes the window where the row disappears between a read and the delete.
    const deleted = await db
      .delete(formQuestion)
      .where(eq(formQuestion.id, request.params.id))
      .returning({ id: formQuestion.id })

    if (deleted.length === 0) return sendError(reply, 404)

    // Deliberately does not renumber the survivors. `order` only has to sort,
    // not be contiguous, and renumbering here would fight a concurrent
    // reorder for no visible gain.
    return reply.code(204).send()
  })

  app.put(apiRoutes.reorderQuestions.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(formQuestionOrderSchema, request)
    if (body === undefined) return sendError(reply, 400)

    // The request must name exactly the questions that exist — `reorder` argues that
    // rule out, and refuses on its own rather than in three places.
    if (reorder(db, formQuestion, await questionsFor(db), body.ids) === 'mismatch') {
      return sendError(reply, 400)
    }

    return { questions: await questionsFor(db) } satisfies FormQuestionsResponse
  })
}
