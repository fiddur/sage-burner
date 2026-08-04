/**
 * Domain enumerations shared by the API, the database layer and the web app.
 *
 * Only genuinely fixed vocabularies live here. Things organisers change between
 * burns are rows instead — `event_option` holds the lodging and helping-out
 * lists, per event, so a new option never needs a code change. The kinds of list
 * are fixed; what is in them is not.
 */

/** Narrowing helper so every guard below stays a one-liner without casting. */
const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && values.some((candidate) => candidate === value)

/** Access level. Deliberately coarse — no fine-grained permissions in v1. */
export const accountRoles = ['admin', 'member'] as const
export type AccountRole = (typeof accountRoles)[number]
export const isAccountRole = (value: unknown): value is AccountRole => isOneOf(accountRoles, value)

/**
 * Lane colours for the scheduling grid.
 *
 * A fixed vocabulary rather than free hex, so the grid can be styled once and
 * stay legible: an organiser picking `#fefefe` for a lane would produce
 * unreadable text nothing in the app could correct. Named rather than valued so
 * light and dark themes can each choose their own shade of `red`.
 */
export const placeColors = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'grey'] as const
export type PlaceColor = (typeof placeColors)[number]
export const isPlaceColor = (value: unknown): value is PlaceColor => isOneOf(placeColors, value)

/**
 * The two per-event lists in `event_option`.
 *
 * `lodging` is a single choice and can carry a capacity — "Temple mattress: 9".
 * `helping` is a multiple choice and does not: nothing runs out of people
 * willing to tend the sauna.
 */
export const eventOptionKinds = ['lodging', 'helping'] as const
export type EventOptionKind = (typeof eventOptionKinds)[number]
export const isEventOptionKind = (value: unknown): value is EventOptionKind =>
  isOneOf(eventOptionKinds, value)

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

/**
 * Membership fee state, tracked per `attendance` — never globally per person.
 *
 * Two values, not three. A half-payment is chased out of band rather than
 * modelled: `partial` was never set by anything, drove a database CHECK and a
 * branch in the member's page, and an unreachable value that every consumer has
 * to handle is the trap the error-code vocabulary already argues against.
 */
/**
 * How much a lead role asks of someone, in each phase of a burn.
 *
 * Three independent answers per role — before, during, after — because a role can
 * be all planning and no presence, or the other way round. Advisory: nothing sorts
 * or warns on them, they are there so somebody choosing a role knows what they are
 * agreeing to.
 */
export const effortLevels = ['none', 'low', 'medium', 'high'] as const
export type EffortLevel = (typeof effortLevels)[number]
export const isEffortLevel = (value: unknown): value is EffortLevel => isOneOf(effortLevels, value)

export const paymentStatuses = ['unpaid', 'paid'] as const
export type PaymentStatus = (typeof paymentStatuses)[number]
export const isPaymentStatus = (value: unknown): value is PaymentStatus => isOneOf(paymentStatuses, value)
