import type { FormQuestion, FormQuestionResponse, FormQuestionsResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import {
  errorResponse,
  formQuestionCreateSchema,
  formQuestionOrderSchema,
  formQuestionUpdateSchema,
} from '@sage-burner/shared'
import { asc, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'

import { createGuards } from '../auth/guards.ts'
import { event, formQuestion } from '../db/schema.ts'
import { noStore } from '../http.ts'

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
      const row: FormQuestion = {
        ...parsed.data,
        id,
        event_id: request.params.eventId,
        order: 0,
      }

      db.transaction((tx) => {
        const rows = tx
          .select({ order: formQuestion.order })
          .from(formQuestion)
          .where(eq(formQuestion.event_id, request.params.eventId))
          .orderBy(asc(formQuestion.order))
          .all()

        row.order = rows.at(-1)?.order === undefined ? 0 : (rows.at(-1)?.order ?? 0) + 1
        tx.insert(formQuestion).values(row).run()
      })

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

      // `agreement` implies `required`, and a PATCH can break that with one field
      // — `{ required: false }` on an existing agreement question, or
      // `{ type: 'agreement' }` on one that is optional. The schema only sees the
      // body, so it catches a contradictory *pair*; the merged row is what
      // actually has to hold.
      const merged = { ...existing, ...parsed.data }
      if (merged.type === 'agreement' && !merged.required) {
        return reply.code(400).send(errorResponse('bad_request'))
      }

      await db.update(formQuestion).set(parsed.data).where(eq(formQuestion.id, request.params.id))

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
