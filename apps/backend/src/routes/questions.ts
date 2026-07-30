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
import { event, formQuestion } from '../db/schema.ts'
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
 * The application form's questions.
 *
 * Rows, not code — organisers retune them between every burn, so adding,
 * editing or reordering one must never need a redeploy, and the web app renders
 * whatever it is handed rather than knowing the questions.
 *
 * Reads are public: the application form is public, so its questions are too.
 * Every write is admin-only.
 */
export const questionsFor = (db: Database, eventId: string): Promise<FormQuestion[]> =>
  db
    .select()
    .from(formQuestion)
    .where(eq(formQuestion.event_id, eventId))
    .orderBy(asc(formQuestion.order), asc(formQuestion.id))

export const registerQuestionRoutes = (app: FastifyInstance, { db, sessions }: GuardDeps) => {
  const { requireAdmin } = createGuards({ db, sessions })

  app.get<{ Params: { eventId: string } }>('/api/events/:eventId/questions', async (request, reply) => {
    // Same reasoning as the active event: public, but an edit has to show up
    // without waiting out a heuristic freshness window.
    void reply.header('cache-control', 'no-cache')

    return { questions: await questionsFor(db, request.params.eventId) } satisfies FormQuestionsResponse
  })

  app.post<{ Params: { eventId: string } }>(
    '/api/admin/events/:eventId/questions',
    { preHandler: requireAdmin },
    async (request, reply) => {
      void noStore(reply)

      const parsed = formQuestionCreateSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

      const [found] = await db
        .select({ id: event.id })
        .from(event)
        .where(eq(event.id, request.params.eventId))
        .limit(1)
      // Checked rather than left to the foreign key: the FK would raise a
      // constraint error and answer 500, where "no such event" is a 404.
      if (found === undefined) return reply.code(404).send(errorResponse('not_found'))

      // New questions go last, and `order` is the server's to assign.
      //
      // Read and insert in one transaction, because otherwise the claim is not
      // true: two requests can observe the same `last` between separate awaits
      // and insert the same `order`. The list stays deterministic either way —
      // `orderBy(asc(order), asc(id))` breaks the tie, and any later reorder
      // renumbers to 0..n-1 — so the symptom is mild. But the comment claimed a
      // guarantee, and a guarantee is cheaper to provide here than to explain
      // away.
      const id = randomUUID()

      // Returns the order rather than assigning into a row from inside the
      // callback. That worked only because `drizzle-orm/node-sqlite` is the
      // synchronous driver — `db.transaction` returns `T`, not a promise, so the
      // mutation landed before the reply was built. Nothing said so, and on an
      // async driver the compiler would not object: the insert would still get the
      // right order and the 201 body would report `order: 0`.
      const order = db.transaction((tx) => {
        const [last] = tx
          .select({ order: formQuestion.order })
          .from(formQuestion)
          .where(eq(formQuestion.event_id, request.params.eventId))
          .orderBy(desc(formQuestion.order))
          .limit(1)
          .all()

        const next = last === undefined ? 0 : last.order + 1
        tx.insert(formQuestion)
          .values({ ...parsed.data, id, event_id: request.params.eventId, order: next })
          .run()

        return next
      })

      const row: FormQuestion = { ...parsed.data, id, event_id: request.params.eventId, order }

      return reply.code(201).send({ question: row } satisfies FormQuestionResponse)
    },
  )

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

      // Same trap as the event PATCH: a body of only unrecognised keys parses to
      // `{}` and `set({})` is not valid SQL, so it would answer 500 to a typo.
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
      if (Number(result.changes) === 0) {
        return rule === undefined
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

  app.put<{ Params: { eventId: string } }>(
    '/api/admin/events/:eventId/questions/order',
    { preHandler: requireAdmin },
    async (request, reply) => {
      void noStore(reply)

      const parsed = formQuestionOrderSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

      // The same probe `POST` does, and for the same reason: without it an unknown
      // event id reads an empty question list, satisfies `sameSet` vacuously, and
      // answers 200 with `{ questions: [] }` — reporting a successful reorder of a
      // form that does not exist. A typo'd or stale id in an admin tool would look
      // like it worked, and the two routes under this prefix would disagree about
      // the same input.
      const [found] = await db
        .select({ id: event.id })
        .from(event)
        .where(eq(event.id, request.params.eventId))
        .limit(1)
      if (found === undefined) return reply.code(404).send(errorResponse('not_found'))

      const existing = await questionsFor(db, request.params.eventId)
      const wanted = parsed.data.ids

      // The request must name exactly this event's questions, no more and no
      // fewer. A partial list would renumber some rows and leave others on
      // stale positions, producing an order nobody asked for; an id from
      // another event would silently move a question off a form it belongs to.
      const sameSet =
        wanted.length === existing.length &&
        new Set(wanted).size === wanted.length &&
        existing.every((row) => wanted.includes(row.id))
      if (!sameSet) return reply.code(400).send(errorResponse('bad_request'))

      // One statement per question, but inside a transaction: a half-applied
      // reorder is an order the organiser never chose, and this is the one
      // write here that touches several rows at once.
      db.transaction((tx) => {
        wanted.forEach((id, index) => {
          tx.update(formQuestion).set({ order: index }).where(eq(formQuestion.id, id)).run()
        })
      })

      return { questions: await questionsFor(db, request.params.eventId) } satisfies FormQuestionsResponse
    },
  )
}
