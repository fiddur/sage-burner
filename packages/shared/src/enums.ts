/**
 * Domain enumerations shared by the API, the database layer and the web app.
 *
 * Only genuinely fixed vocabularies live here. Things that organisers change
 * between burns — lodging options, shift types — are deliberately free text on
 * the member record instead, so a new option never needs a code change.
 */

/** Narrowing helper so every guard below stays a one-liner without casting. */
const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && values.some((candidate) => candidate === value)

/** Access level. Deliberately coarse — no fine-grained permissions in v1. */
export const accountRoles = ['admin', 'member'] as const
export type AccountRole = (typeof accountRoles)[number]
export const isAccountRole = (value: unknown): value is AccountRole => isOneOf(accountRoles, value)

/** Lifecycle of a membership application. */
export const applicationStatuses = ['pending', 'approved', 'rejected'] as const
export type ApplicationStatus = (typeof applicationStatuses)[number]
export const isApplicationStatus = (value: unknown): value is ApplicationStatus =>
  isOneOf(applicationStatuses, value)

/**
 * Question types the application form can render.
 *
 * `agreement` is a checkbox carrying linked or inline text that must be ticked
 * to submit — the "I agree to the 10+1 principles" case. It is distinct from
 * `checkbox` precisely because submission is blocked when it is unticked.
 */
export const formQuestionTypes = ['text', 'textarea', 'checkbox', 'agreement'] as const
export type FormQuestionType = (typeof formQuestionTypes)[number]
export const isFormQuestionType = (value: unknown): value is FormQuestionType =>
  isOneOf(formQuestionTypes, value)

/** Membership fee state, tracked per (event, member) — never globally per person. */
export const paymentStatuses = ['unpaid', 'partial', 'paid'] as const
export type PaymentStatus = (typeof paymentStatuses)[number]
export const isPaymentStatus = (value: unknown): value is PaymentStatus => isOneOf(paymentStatuses, value)
