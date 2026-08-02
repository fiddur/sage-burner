import { z } from 'zod'

import { MAX_ANSWER_LENGTH, MAX_APPLICANT_CONTACT_LENGTH, MAX_APPLICANT_NAME_LENGTH } from '../answers.ts'
import { applicationStatuses, formQuestionTypes } from '../enums.ts'
import { dateTimeSchema, idSchema, nonEmptyText } from './common.ts'

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
 * A reference alone does not survive the questions changing. Organisers retune
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
  label: nonEmptyText(500),
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
  applicant_contact: nonEmptyText(MAX_APPLICANT_CONTACT_LENGTH),
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
    applicant_contact: nonEmptyText(MAX_APPLICANT_CONTACT_LENGTH),
    answers: submittedAnswersSchema,
  })
  .strict()

export const applicationResponseSchema = z.object({ application: applicationSchema })

export const applicationsResponseSchema = z.object({ applications: z.array(applicationSchema) })

/**
 * An invite, shown exactly once.
 *
 * Only the SHA-256 digest is kept, so the raw token exists in this response and
 * nowhere else — an organiser who loses the link cannot be sent it again, and
 * that is the point rather than an oversight.
 */
export const inviteSchema = z.object({
  token: nonEmptyText(200),
  expires_at: dateTimeSchema,
})

/**
 * What `POST /api/admin/invites` answers with.
 *
 * Named rather than declared inline at both ends: the route and `client.ts` each
 * used to write `{ invite: … }` out for themselves, so renaming a key on one side
 * compiled cleanly against the other.
 */
export const inviteResponseSchema = z.object({ invite: inviteSchema })

export const applicationDecisionResponseSchema = z.object({
  application: applicationSchema,
  /** Null on rejection. An approval either mints one or fails. */
  invite: inviteSchema.nullable(),
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
export type InviteResponse = z.infer<typeof inviteResponseSchema>
export type ApplicationDecisionResponse = z.infer<typeof applicationDecisionResponseSchema>
