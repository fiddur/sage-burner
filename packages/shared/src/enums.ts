/**
 * Domain enumerations shared by the API, the database layer and the web app.
 *
 * Only genuinely fixed vocabularies live here. Things that organisers change
 * between burns — lodging options, shift types — are deliberately free text on
 * the `attendance` row instead, so a new option never needs a code change.
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

/**
 * What `required` must be for a type, or `undefined` when it is the organiser's
 * choice.
 *
 * An `agreement` is a checkbox that blocks submission until ticked, so
 * `required: false` would erase the only thing distinguishing it from
 * `checkbox`. A `checkbox` is present in the body whether ticked or not, so
 * "must be present" is vacuous and the only other reading — "must be ticked" —
 * is `agreement` again. Two spellings of one rule is the ambiguity, so the
 * second is refused rather than left for a consumer to interpret.
 *
 * Four places enforce this: the create schema, the update schema, the PATCH
 * handler's `UPDATE ... WHERE`, and generated CHECK constraints in the backend's
 * `db/schema.ts`. It was written out separately in each at first and the copies
 * drifted within the hour — the handler covered `agreement` and not `checkbox`,
 * so a request producing a required checkbox reached the database CHECK and
 * answered 500 instead of 400.
 *
 * It lives here rather than beside those schemas because the web app needs it at
 * runtime — `QuestionEditor` decides from it whether to fix or offer the
 * checkbox — and this module imports nothing. Defined next to `formQuestionTypes`
 * it also sits where a fifth type gets added, which is the change it has to stay
 * in step with.
 */
export const tickBoxRequired = (type: string): boolean | undefined => {
  if (type === 'agreement') return true
  if (type === 'checkbox') return false

  return undefined
}

/**
 * What an outstanding invite is doing, derived rather than stored.
 *
 * Storing it would mean a row whose truth depends on the clock going stale in
 * the database — an invite becomes expired by time passing, not by anyone
 * writing to it.
 */
export const inviteStatuses = ['outstanding', 'used', 'expired'] as const
export type InviteStatus = (typeof inviteStatuses)[number]
export const isInviteStatus = (value: unknown): value is InviteStatus => isOneOf(inviteStatuses, value)

/**
 * `used` wins over `expired`: an invite that was redeemed and then ran out is
 * spent, and calling it expired would suggest re-issuing it to someone already
 * in.
 */
export const inviteStatusOf = (
  invite: { expires_at: string; used_at: string | null },
  now: Date,
): InviteStatus => {
  if (invite.used_at !== null) return 'used'

  return Date.parse(invite.expires_at) <= now.getTime() ? 'expired' : 'outstanding'
}

/** Membership fee state, tracked per `attendance` — never globally per person. */
export const paymentStatuses = ['unpaid', 'partial', 'paid'] as const
export type PaymentStatus = (typeof paymentStatuses)[number]
export const isPaymentStatus = (value: unknown): value is PaymentStatus => isOneOf(paymentStatuses, value)
