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
  now?: () => Date
  /**
   * Tell the admins, if anything is listening.
   *
   * Optional so the route stands alone: a test about applications should not have
   * to know that notifications exist, and an installation with nobody subscribed
   * does nothing here either way.
   */
  notify?: (message: string) => Promise<unknown>
}

/**
 * Applying to join — the one write in this app open to the public, since an
 * applicant has no account yet.
 *
 * Everything in the body is attacker-controlled. `.strict()` turns an attempt at
 * `status` or `id` into a 400 rather than a silently dropped key, and the labels
 * stored beside each answer come from the question rows, so nobody can record a
 * question in wording they chose.
 *
 * The submitter does name which questions they were shown, and that list decides
 * what gets an entry — so the guarantee is narrower than "nobody can record a
 * question that was never asked", in both directions. A crafted body can *omit*
 * an optional question it was shown and left blank, storing it as never-asked;
 * and it can *name* one the page never rendered, storing an "asked, said no"
 * entry for something nobody was shown. Both are someone misdescribing their own
 * application, which is not an attack worth machinery — the wording still comes
 * from the question rows, and validation still runs against the server's list, so
 * neither buys them anything a reviewer would act on.
 *
 * Not rate-limited here, consistent with login: throttling lives in the reverse
 * proxy where an operator can see it. Nothing here grants access, so the worst a
 * flood produces is junk in the review list — and, since #96, a notification on
 * every subscribed admin's device per submission. `sw.js` gives them one `tag` so
 * the display collapses rather than piling up, which makes that annoying rather
 * than a reason to throttle here; #57 is where a bound would go.
 */
export const registerApplicationRoutes = (
  app: FastifyInstance,
  { db, now = () => new Date(), notify }: ApplicationRouteDeps,
) => {
  app.post(apiRoutes.submitApplication.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(applicationCreateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const questions = await questionsFor(db)

    // Sharing these rules with the form buys agreement about the answers given
    // the same questions, not that a client-complete submission is
    // server-complete: the form ran them against the questions as they were when
    // the page loaded, and this is the side that decides.
    if (answerProblems(questions, body.answers).length > 0) {
      return sendError(reply, 400)
    }

    // An answer to something the form says it never showed is a body disagreeing
    // with itself, and dropping it silently would lose what someone typed.
    const asked = new Set(body.asked)
    if (Object.keys(body.answers).some((id) => !asked.has(id))) {
      return sendError(reply, 400)
    }

    // A question in `asked` that is no longer in `questions` — deleted while the
    // form was open — is dropped here, with nothing to store: the wording comes
    // from the row, and the row is gone. Only reachable when the body carries no
    // *key* for it: any key naming it, `''` included, is `unknown` to
    // `answerProblems` and 400s above. A text field typed into and then cleared
    // sends `''`, so "left blank" on screen is not the same thing.
    //
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

    // Not awaited, and its failures never reach the applicant. The application is
    // written by now, so a slow or broken push service must not turn a successful
    // application into an error — and an unauthenticated route must not be a place
    // where a stranger can make the server wait on Google. Reported to the log,
    // which is the only place a delivery problem is actionable.
    //
    // Deliberately says nothing about who applied: a notification is read on a
    // lock screen, and the applicant's name is theirs until an admin opens the
    // page. `notifyAdmins` sends the same payload to every subscriber for the
    // same reason — there is nothing in it worth personalising.
    if (notify !== undefined) {
      void notify('Someone has applied to join.').catch((failure: unknown) => {
        request.log.error({ err: failure }, 'notifying admins of an application failed')
      })
    }

    return reply.code(201).send({ application: row } satisfies ApplicationResponse)
  })
}
