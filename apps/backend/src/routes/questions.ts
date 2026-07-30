import type { FormQuestion, FormQuestionResponse, FormQuestionsResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import {
  errorResponse,
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

import { createGuards } from '../auth/guards.ts'
import { formQuestion } from '../db/schema.ts'
import { noStore } from '../http.ts'

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
 * No cross-reference to `routes/events.ts`: its date-order check is a plain JS
 * comparison on the merged row and carries the same race. A branch in flight turns
 * it into a statement-level condition, but naming a symbol that does not exist here
 * is worse than saying nothing.
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
 * Rows, not code: organisers retune them between burns, so adding, editing or
 * reordering one must never need a redeploy, and the web app renders whatever it
 * is handed rather than knowing the questions.
 *
 * Reads are public, because the application form is. Every write is admin-only.
 */
export const questionsFor = (db: Database): Promise<FormQuestion[]> =>
  db.select().from(formQuestion).orderBy(asc(formQuestion.order), asc(formQuestion.id))

export const registerQuestionRoutes = (app: FastifyInstance, { db, sessions }: GuardDeps) => {
  const { requireAdmin } = createGuards({ db, sessions })

  app.get('/api/questions', async (_request, reply) => {
    // Same reasoning as the active event: public, but an edit has to show up
    // without waiting out a heuristic freshness window.
    void reply.header('cache-control', 'no-cache')

    return { questions: await questionsFor(db) } satisfies FormQuestionsResponse
  })

  app.post('/api/admin/questions', { preHandler: requireAdmin }, async (request, reply) => {
    void noStore(reply)

    const parsed = formQuestionCreateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

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
        .values({ ...parsed.data, id, order: next })
        .run()

      return next
    })

    const row: FormQuestion = { ...parsed.data, id, order }

    return reply.code(201).send({ question: row } satisfies FormQuestionResponse)
  })

  app.patch<{ Params: { id: string } }>(
    '/api/admin/questions/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      void noStore(reply)

      const parsed = formQuestionUpdateSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

      const [existing] = await db
        .select()
        .from(formQuestion)
        .where(eq(formQuestion.id, request.params.id))
        .limit(1)
      if (existing === undefined) return reply.code(404).send(errorResponse('not_found'))

      // `{}` is the only body that changes nothing now — an unrecognised key is a
      // 400 from `.strict()` above — and `set({})` is not valid SQL, so it has to
      // be answered before the statement. A no-op PATCH is idempotent; returning
      // the row unchanged is the honest answer.
      if (Object.keys(parsed.data).length === 0) {
        return { question: existing } satisfies FormQuestionResponse
      }

      // No merged-row check in JS. A PATCH can break the tick-box rule with a
      // single field from either direction, and the schema cannot decide a lone key
      // — but a read-then-check here is a race (see `tickBoxCondition`), and a JS
      // fail-fast would also pre-empt the statement in every non-racing case, so
      // nothing would exercise the condition that does the real work.
      const merged = { ...existing, ...parsed.data }
      const rule = tickBoxCondition(parsed.data)
      const where =
        rule === undefined
          ? eq(formQuestion.id, request.params.id)
          : and(eq(formQuestion.id, request.params.id), rule)

      const result = await db.update(formQuestion).set(parsed.data).where(where)

      // Zero rows, split the way the event PATCH splits it: with a condition in the
      // `WHERE` it is overwhelmingly the rule that failed, so 400. Without one, only
      // the id was matched, so the row was deleted between the read and the write —
      // 404, the same answer as a row that was already gone.
      // Zero rows has two causes: the tick-box condition failed, or the row was
      // deleted between the read above and this write. Told apart by asking, not
      // guessed at from whether a condition was present — guessing answered
      // "Request failed (400)" for a question that no longer exists.
      if (Number(result.changes) === 0) {
        const [stillThere] = await db
          .select({ id: formQuestion.id })
          .from(formQuestion)
          .where(eq(formQuestion.id, request.params.id))
          .limit(1)

        return stillThere === undefined
          ? reply.code(404).send(errorResponse('not_found'))
          : reply.code(400).send(errorResponse('bad_request'))
      }

      return { question: merged } satisfies FormQuestionResponse
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/admin/questions/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      void noStore(reply)

      const [existing] = await db
        .select({ id: formQuestion.id })
        .from(formQuestion)
        .where(eq(formQuestion.id, request.params.id))
        .limit(1)
      if (existing === undefined) return reply.code(404).send(errorResponse('not_found'))

      await db.delete(formQuestion).where(eq(formQuestion.id, request.params.id))

      // Deliberately does not renumber the survivors. `order` only has to sort,
      // not be contiguous, and renumbering here would fight a concurrent
      // reorder for no visible gain.
      return reply.code(204).send()
    },
  )

  app.put('/api/admin/questions/order', { preHandler: requireAdmin }, async (request, reply) => {
    void noStore(reply)

    const parsed = formQuestionOrderSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

    const existing = await questionsFor(db)
    const wanted = parsed.data.ids

    // The request must name exactly the questions that exist, no more and no
    // fewer. A partial list would renumber some rows and leave others on stale
    // positions, producing an order nobody asked for.
    const sameSet =
      wanted.length === existing.length &&
      new Set(wanted).size === wanted.length &&
      existing.every((row) => wanted.includes(row.id))
    if (!sameSet) return reply.code(400).send(errorResponse('bad_request'))

    // One statement per question, but inside a transaction: a half-applied
    // reorder is an order the organiser never chose, and this is the one write
    // here that touches several rows at once.
    db.transaction((tx) => {
      wanted.forEach((id, index) => {
        tx.update(formQuestion).set({ order: index }).where(eq(formQuestion.id, id)).run()
      })
    })

    return { questions: await questionsFor(db) } satisfies FormQuestionsResponse
  })
}
