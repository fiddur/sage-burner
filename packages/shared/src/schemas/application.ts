import { z } from 'zod'

import {
  MAX_ANSWER_LENGTH,
  MAX_APPLICANT_EMAIL_LENGTH,
  MAX_APPLICANT_NAME_LENGTH,
  MAX_ASKED_QUESTIONS,
} from '../answers.ts'
import { applicationStatuses, formQuestionTypes } from '../enums.ts'
import { MAX_QUESTION_LABEL } from '../limits.ts'
import { emailSchema } from './auth.ts'
import { dateTimeSchema, idSchema, nonEmptyText } from './common.ts'
import { mailTestResponseSchema } from './mail.ts'

/**
 * One answer's value. Text questions yield a string; `checkbox` and `agreement`
 * questions yield a boolean.
 */
export const answerValueSchema = z.union([z.string().max(MAX_ANSWER_LENGTH), z.boolean()])

/**
 * What a submitter sends: values keyed by `form_question.id`.
 *
 * `partialRecord`, not `record`: a plain `z.record` infers a non-optional index
 * signature, so `answers[question.id]` would type as `string | boolean` while
 * being `undefined` at runtime for every unanswered optional question — and the
 * dynamic form renderer indexes into exactly that. Runtime behaviour is
 * identical; this just stops the type lying.
 *
 * Only the values. The wording is not accepted from the client, because a
 * client that supplied it could record a question that was never asked.
 */
export const submittedAnswersSchema = z.partialRecord(idSchema, answerValueSchema)

/**
 * What is stored: the question as it was worded when asked, beside the answer.
 *
 * A reference alone does not survive the questions changing. Admins retune
 * the form between burns — that is the whole reason the questions are rows
 * rather than code — so an answer keyed only by id means one of two bad things
 * later: the question was edited and the stored answer now reads as a reply to
 * wording nobody was shown, or it was deleted and the answer cannot be labelled
 * at all.
 *
 * Snapshotting costs a few hundred bytes per application and makes the record
 * self-contained: what was asked, and what they said. `question_id` is kept
 * alongside so a reviewer can still group answers across applications.
 */
export const storedAnswerSchema = z.object({
  question_id: idSchema,
  /** The label exactly as shown to this applicant. */
  label: nonEmptyText(MAX_QUESTION_LABEL),
  type: z.enum(formQuestionTypes),
  value: answerValueSchema,
})

export const storedAnswersSchema = z.array(storedAnswerSchema)

/**
 * One application to the community.
 *
 * There is no `event_id`, deliberately: you apply to join us, not to a
 * particular burn. Once approved you are a member and may mark your intention
 * to join any burn, which is a separate record — the same person applies once
 * and attends several.
 */
export const applicationSchema = z.object({
  id: idSchema,
  answers: storedAnswersSchema,
  status: z.enum(applicationStatuses),
  applicant_name: nonEmptyText(MAX_APPLICANT_NAME_LENGTH),
  /**
   * Where the invite is sent, and the address the account will be made under (#30).
   *
   * Was `applicant_contact`, one free-text box asking how to reach somebody, which
   * held phone numbers and Discord handles as often as addresses. Once approving
   * somebody posts them a link, "how can we reach you" is no longer the question —
   * the app needs the one thing it can actually write to.
   *
   * Not normalised the way `emailSchema` normalises a login: this is stored as typed
   * and only becomes an identity when the invite is redeemed, which is where the
   * lowercasing that the UNIQUE depends on belongs. Rows written before this was an
   * address keep whatever they held.
   */
  applicant_email: z.string().max(MAX_APPLICANT_EMAIL_LENGTH),
  submitted_at: dateTimeSchema,
  /** Set when an admin approves or rejects; null while pending. */
  decided_at: dateTimeSchema.nullable(),
})

/**
 * What a member of the public submits.
 *
 * `id`, `status`, `submitted_at` and `decided_at` are the server's — a submitter
 * who could set `status` would approve themselves — and so is every answer's
 * `label`, which the server reads from the question rows rather than trusting.
 *
 * `.strict()` for the reason the event and question schemas give: an
 * unrecognised key is a 400 rather than a silent success, so a typo'd field name
 * cannot be quietly dropped and answered 201.
 *
 * The answers are checked for shape here and for *meaning* by `answerProblems`,
 * which needs the question list and so cannot live in a schema.
 */
export const applicationCreateSchema = z
  .object({
    applicant_name: nonEmptyText(MAX_APPLICANT_NAME_LENGTH),
    // `emailSchema` rather than the loose field above: a submission is where an
    // address can still be corrected by the person typing it, and an invite posted
    // to a typo is an application that silently goes nowhere.
    applicant_email: emailSchema,
    answers: submittedAnswersSchema,
    /**
     * The questions the form actually put on screen.
     *
     * Sent so that a question added while someone was filling the form in is not
     * stored against them as `""` or `false` — which reads as "asked and
     * declined" when they never saw it, and that distinction is the whole reason
     * an entry is kept per question rather than per answer.
     *
     * It narrows what is *stored*, never what is *checked*. Validation runs
     * against the server's list, or "I wasn't shown that" would be a way to skip
     * a required question or an agreement.
     *
     * Required rather than optional, and deliberately so despite the cost: a page
     * loaded before this deployed sends no `asked` and gets a 400. That is the
     * right failure — its own handler says to reload, which is the remedy — where
     * falling back to the current question list would silently reintroduce this
     * bug for every stale client.
     */
    asked: z.array(idSchema).max(MAX_ASKED_QUESTIONS),
  })
  .strict()

export const applicationResponseSchema = z.object({ application: applicationSchema })

export const applicationsResponseSchema = z.object({ applications: z.array(applicationSchema) })

/**
 * An invite, shown exactly once.
 *
 * Only the SHA-256 digest is kept, so the raw token exists in this response and
 * nowhere else. Losing it before pasting it somewhere is recoverable —
 * `POST /api/admin/applications/:id/invite` mints a replacement into the same row
 * and kills the old link doing it — but the token itself is gone for good.
 */
export const inviteSchema = z.object({
  token: nonEmptyText(200),
  expires_at: dateTimeSchema,
})

/**
 * Whether the invite was emailed, and what the mail server said if not (#327).
 *
 * The same shape a test message answers with, reused rather than invented twice —
 * `{ sent, to, reason }` is exactly the question here too. **Null means nothing was
 * attempted**, which is the case a direct invite is always in and an application from
 * before #30 may be: `applicant_email` held Discord handles and phone numbers, and
 * `looksLikeEmail` is what decides. That is a different thing from a send that failed,
 * and the two need different words — the admin was told to send the link either way,
 * so a real invite went missing behind a TLS misconfiguration that never surfaced.
 */
export const inviteDeliverySchema = mailTestResponseSchema.nullable()

/**
 * What `POST /api/admin/invites` answers with.
 *
 * Named rather than declared inline at both ends: the route and `client.ts` each
 * used to write `{ invite: … }` out for themselves, so renaming a key on one side
 * compiled cleanly against the other.
 */
export const inviteResponseSchema = z.object({ invite: inviteSchema, delivery: inviteDeliverySchema })

export const applicationDecisionResponseSchema = z.object({
  application: applicationSchema,
  /** Null on rejection. An approval either mints one or fails. */
  invite: inviteSchema.nullable(),
  delivery: inviteDeliverySchema,
})

export type AnswerValue = z.infer<typeof answerValueSchema>
export type SubmittedAnswers = z.infer<typeof submittedAnswersSchema>
export type StoredAnswer = z.infer<typeof storedAnswerSchema>
export type StoredAnswers = z.infer<typeof storedAnswersSchema>
export type Application = z.infer<typeof applicationSchema>
export type ApplicationCreate = z.infer<typeof applicationCreateSchema>
export type ApplicationResponse = z.infer<typeof applicationResponseSchema>
export type ApplicationsResponse = z.infer<typeof applicationsResponseSchema>
export type Invite = z.infer<typeof inviteSchema>
export type InviteDelivery = z.infer<typeof inviteDeliverySchema>
export type InviteResponse = z.infer<typeof inviteResponseSchema>
export type ApplicationDecisionResponse = z.infer<typeof applicationDecisionResponseSchema>
