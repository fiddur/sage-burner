import { z } from 'zod'

import {
  MAX_ANSWER_LENGTH,
  MAX_APPLICANT_EMAIL_LENGTH,
  MAX_APPLICANT_NAME_LENGTH,
  MAX_ASKED_QUESTIONS,
} from '../answers.ts'
import { applicationStatuses, formQuestionTypes, oauthProviders } from '../enums.ts'
import { MAX_COMMENT, MAX_QUESTION_LABEL } from '../limits.ts'
import { emailSchema } from './auth.ts'
import { dateTimeSchema, idSchema, nonEmptyText } from './common.ts'
import { mailTestResponseSchema } from './mail.ts'

export const answerValueSchema = z.union([z.string().max(MAX_ANSWER_LENGTH), z.boolean()])

export const submittedAnswersSchema = z.partialRecord(idSchema, answerValueSchema)

export const storedAnswerSchema = z.object({
  question_id: idSchema,
  label: nonEmptyText(MAX_QUESTION_LABEL),
  type: z.enum(formQuestionTypes),
  value: answerValueSchema,
})

export const storedAnswersSchema = z.array(storedAnswerSchema)

export const applicantIdentitySchema = z.object({
  provider: z.enum(oauthProviders),
  name: z.string().nullable(),
  profile_url: z.string().nullable(),
})

export const applicationSchema = z.object({
  id: idSchema,
  account_id: idSchema.nullable(),
  answers: storedAnswersSchema,
  status: z.enum(applicationStatuses),
  applicant_name: nonEmptyText(MAX_APPLICANT_NAME_LENGTH),
  applicant_email: z.string().max(MAX_APPLICANT_EMAIL_LENGTH),
  submitted_at: dateTimeSchema,
  decided_at: dateTimeSchema.nullable(),
})

export const adminApplicationSchema = applicationSchema.extend({
  identities: z.array(applicantIdentitySchema),
})

export const applicationMessageSchema = z.object({
  id: idSchema,
  author_account_id: idSchema,
  author_name: z.string().nullable(),
  mine: z.boolean(),
  body: z.string(),
  created_at: dateTimeSchema,
})
export type ApplicantIdentity = z.infer<typeof applicantIdentitySchema>
export type AdminApplication = z.infer<typeof adminApplicationSchema>
export type ApplicationMessage = z.infer<typeof applicationMessageSchema>

export const applicationMessageInputSchema = z.object({ body: nonEmptyText(MAX_COMMENT) }).strict()
export type ApplicationMessageInput = z.infer<typeof applicationMessageInputSchema>

export const applicationMessagesResponseSchema = z.object({
  messages: z.array(applicationMessageSchema),
})
export type ApplicationMessagesResponse = z.infer<typeof applicationMessagesResponseSchema>

/** What somebody with no roles yet sees of their own: their standing, and who to ask about it. */
export const myApplicationSchema = z.object({
  application: applicationSchema.nullable(),
  messages: z.array(applicationMessageSchema),
  organisers: z.array(
    z.object({
      account_id: idSchema,
      name: z.string().nullable(),
      contact: z.string().nullable(),
    }),
  ),
})
export const myApplicationResponseSchema = z.object({ mine: myApplicationSchema })
export type MyApplication = z.infer<typeof myApplicationSchema>
export type MyApplicationResponse = z.infer<typeof myApplicationResponseSchema>

export const applicationCreateSchema = z
  .object({
    applicant_name: nonEmptyText(MAX_APPLICANT_NAME_LENGTH),
    applicant_email: emailSchema.optional(),
    answers: submittedAnswersSchema,
    asked: z.array(idSchema).max(MAX_ASKED_QUESTIONS),
  })
  .strict()

export const applicationResponseSchema = z.object({ application: applicationSchema })

export const applicationsResponseSchema = z.object({ applications: z.array(adminApplicationSchema) })

export const inviteSchema = z.object({
  token: nonEmptyText(200),
  expires_at: dateTimeSchema,
})

export const inviteDeliverySchema = mailTestResponseSchema.nullable()

export const inviteResponseSchema = z.object({ invite: inviteSchema, delivery: inviteDeliverySchema })

export const applicationDecisionResponseSchema = z.object({
  application: applicationSchema,
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
