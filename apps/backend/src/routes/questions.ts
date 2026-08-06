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
import { and, asc, desc, eq, notInArray } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'

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

export const registerQuestionRoutes = (app: FastifyInstance, { db }: GuardDeps) => {
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

    // Read and insert in one transaction, because otherwise "the server assigns
    // `order`" is not true: two requests can observe the same last row between
    // separate awaits and insert the same position. The order is returned rather
    // than assigned into a row from inside the callback — that worked only because
    // `drizzle-orm/node-sqlite` is synchronous, and on an async driver the insert
    // would still be right while the 201 body reported `order: 0`.
    const order = db.transaction((tx) => {
      const [last] = tx
        .select({ order: formQuestion.order })
        .from(formQuestion)
        .orderBy(desc(formQuestion.order))
        .limit(1)
        .all()

      const next = last === undefined ? 0 : last.order + 1
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

    // The only body that never reaches the `UPDATE`, and so the only one that
    // needs a read of its own. An unrecognised key is a 400 from `.strict()`
    // above, so `{}` is all that is left that changes nothing — and `set({})` is
    // not valid SQL. A no-op PATCH is idempotent; returning the row unchanged is
    // the honest answer.
    //
    // The read lives inside this branch rather than above it, for the reason
    // `events.ts` gives: once `.returning()` supplies the response row and the
    // re-read below answers a vanished one, an unconditional pre-read only spends
    // a third query to produce a 404 the write path produces anyway — and leaves
    // the handler holding a pre-write snapshot to be tempted by.
    if (Object.keys(body).length === 0) {
      const [existing] = await db
        .select()
        .from(formQuestion)
        .where(eq(formQuestion.id, request.params.id))
        .limit(1)

      return existing === undefined
        ? sendError(reply, 404)
        : ({ question: existing } satisfies FormQuestionResponse)
    }

    // No merged-row check in JS. A PATCH can break the tick-box rule with a
    // single field from either direction, and the schema cannot decide a lone key
    // — but a read-then-check here is a race (see `tickBoxCondition`), and a JS
    // fail-fast would also pre-empt the statement in every non-racing case, so
    // nothing would exercise the condition that does the real work.
    const where = and(eq(formQuestion.id, request.params.id), tickBoxCondition(body))
    if (where === undefined) throw new Error('refusing an unfiltered UPDATE on form_question')

    // `.returning()` rather than reading `changes`, for the reasons `events.ts`
    // gives: the row it hands back is the row as written, so the response cannot
    // report a field from the pre-read snapshot that another write has since
    // changed — two admins patching the same question, one sending `help_text`
    // and one `label`, would otherwise each be told their own change landed and
    // the other's did not.
    const updated = await db.update(formQuestion).set(body).where(where).returning()

    const [row] = updated
    if (row === undefined) {
      // Nothing is read before the write on this path — the only `select` above
      // is inside the empty-body branch, which returns — so zero rows has three
      // causes, not two: the id never existed, the row was deleted a moment ago,
      // or the tick-box condition refused the change. The first two are the same
      // answer and the same question to ask.
      //
      // Told apart by asking rather than guessed at from whether a condition was
      // present: guessing answered "Request failed (400)" for a question that is
      // not there.
      const [stillThere] = await db
        .select({ id: formQuestion.id })
        .from(formQuestion)
        .where(eq(formQuestion.id, request.params.id))
        .limit(1)

      return stillThere === undefined ? sendError(reply, 404) : sendError(reply, 400)
    }

    return { question: row } satisfies FormQuestionResponse
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

    const existing = await questionsFor(db)
    const wanted = body.ids

    // The request must name exactly the questions that exist, no more and no
    // fewer. A partial list would renumber some rows and leave others on stale
    // positions, producing an order nobody asked for.
    // No distinctness check: it is implied. `wanted` has exactly `existing.length`
    // slots and must contain every existing id, and those are distinct because `id`
    // is the primary key — so `existing.length` distinct values in that many slots
    // leaves no room for a duplicate. Testing it separately would have been a
    // conjunct that can never be the one that decides.
    const sameSet = wanted.length === existing.length && existing.every((row) => wanted.includes(row.id))
    if (!sameSet) return sendError(reply, 400)

    // One statement per question, but inside a transaction: a half-applied
    // reorder is an order the admin never chose, and this is the one write
    // here that touches several rows at once.
    db.transaction((tx) => {
      wanted.forEach((id, index) => {
        tx.update(formQuestion).set({ order: index }).where(eq(formQuestion.id, id)).run()
      })
    })

    return { questions: await questionsFor(db) } satisfies FormQuestionsResponse
  })
}
