/**
 * Domain enumerations shared by the API, the database layer and the web app.
 *
 * Only genuinely fixed vocabularies live here. Things admins change between
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
 * stay legible: an admin picking `#fefefe` for a lane would produce
 * unreadable text nothing in the app could correct. Named rather than valued so
 * light and dark themes can each choose their own shade of `red`.
 */
export const placeColors = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'grey'] as const
export type PlaceColor = (typeof placeColors)[number]
export const isPlaceColor = (value: unknown): value is PlaceColor => isOneOf(placeColors, value)

/**
 * Which half of the rideshare board a row is on (#26).
 *
 * One vocabulary rather than two tables: everything else about a journey is the same
 * whichever way it is going, and the board draws the two under headings of their own.
 */
export const rideKinds = ['needs', 'offers'] as const
export type RideKind = (typeof rideKinds)[number]

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

/**
 * What a slot in the kitchen's day is.
 *
 * `meal` draws three blocks in the schedule — the two hours cooking, the hour of
 * eating, the hour cleaning up. `chore` draws one, because cooking for a morning
 * cleanup is nonsense. Nothing else reads it: both kinds take a lead, helpers and
 * a cleanup crew.
 */
export const mealSlotKinds = ['meal', 'chore'] as const
export type MealSlotKind = (typeof mealSlotKinds)[number]
export const isMealSlotKind = (value: unknown): value is MealSlotKind => isOneOf(mealSlotKinds, value)

/** Who somebody is on a meal. One lead; any number of the other two. */
export const mealRoles = ['lead', 'helper', 'cleanup'] as const
export type MealRole = (typeof mealRoles)[number]
export const isMealRole = (value: unknown): value is MealRole => isOneOf(mealRoles, value)

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
 * What `required` must be for a type, or `undefined` when it is the admin's
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

/**
 * Membership fee state, tracked per `attendance` — never globally per person.
 *
 * Two values, not three. A half-payment is chased out of band rather than
 * modelled: `partial` was never set by anything, drove a database CHECK and a
 * branch in the member's page, and an unreachable value that every consumer has
 * to handle is the trap the error-code vocabulary already argues against.
 */
export const paymentStatuses = ['unpaid', 'paid'] as const
export type PaymentStatus = (typeof paymentStatuses)[number]
export const isPaymentStatus = (value: unknown): value is PaymentStatus => isOneOf(paymentStatuses, value)

/**
 * What a notification can be about (#248).
 *
 * The vocabulary is here, Zod-free, because the settings table on the web renders a
 * row per category and must not pull Zod into the bundle to do it.
 *
 * A category is what somebody switches off, so the split is by *what happened to
 * them* rather than by which route wrote it: being put on a meal and being taken off
 * one are one line in the settings, because nobody wants one without the other.
 */
export const notificationCategories = [
  'meal_role',
  'dream_role',
  'lead_role',
  'payment',
  'waiting_list_near',
  'waiting_list_pushed',
  'dream_offered',
  'dream_comment',
  'dream_comment_any',
  'member_joined',
  'lead_role_added',
  'lead_role_filled',
  'new_version',
  'application',
] as const
export type NotificationCategory = (typeof notificationCategories)[number]

/**
 * Everything the settings table needs to render one row, in one place (#259).
 *
 * One record rather than a `labels` map beside an `on` map beside an `about` map:
 * three objects keyed by the same union are three things to keep in step, and the
 * one that goes stale is silent. `satisfies` makes a missing category a type error,
 * so adding one to the list above cannot compile until it is described here.
 *
 * - `label` — what the settings table calls it. Where the bell *sends* you is the
 *   route's business.
 * - `on` — whether it is on for somebody who has never said. **The two halves differ
 *   deliberately.** What happens *to you* is on: being put on a meal is not noise,
 *   and somebody who never opens the settings should still hear it. What happens
 *   *around you* is off, because a burn where every dream and every arrival pings
 *   forty-two people is a channel people learn to ignore (#259).
 * - `about` — which section it belongs in. Not derived from `on`: that they line up
 *   today is a coincidence, and the first category that breaks it would land in the
 *   wrong section silently. `else` is "not about you personally", which is a wider
 *   net than "about a burn" — a redeploy is neither. `admin` is narrower than either:
 *   only an admin is ever told, so only an admin is offered the switch (#326).
 */
export interface NotificationCategoryInfo {
  about: 'admin' | 'else' | 'you'
  label: string
  on: boolean
}

export const notificationCategoryInfo = {
  meal_role: { label: 'Put on or taken off a meal', on: true, about: 'you' },
  dream_role: { label: 'Put on or taken off a dream', on: true, about: 'you' },
  lead_role: { label: 'Given or taken off a lead role', on: true, about: 'you' },
  payment: { label: 'Your payment recorded', on: true, about: 'you' },
  waiting_list_near: {
    label: 'The burn is nearly full and you have not paid',
    on: true,
    about: 'you',
  },
  waiting_list_pushed: {
    label: 'The burn filled up and you are on the waiting list',
    on: true,
    about: 'you',
  },
  dream_offered: { label: 'Somebody offers a dream', on: false, about: 'else' },
  // The pair splits by whether the conversation is one you are in (#375). Being
  // answered is what makes somebody come back to a thread, so the first is on;
  // hearing every word said about every dream is the digest's problem, so the
  // second is off until asked for.
  dream_comment: { label: 'Somebody comments on a dream you are part of', on: true, about: 'you' },
  dream_comment_any: { label: 'Somebody comments on any dream', on: false, about: 'else' },
  member_joined: { label: 'Somebody says they are coming', on: false, about: 'else' },
  lead_role_added: { label: 'A lead role is added', on: false, about: 'else' },
  lead_role_filled: { label: 'Somebody takes the lead of a role', on: false, about: 'else' },
  new_version: { label: 'A new version of the app is out', on: false, about: 'else' },
  // On, and about the one thing that waits for somebody: an application nobody
  // reviews leaves the applicant waiting (#326).
  application: { label: 'Somebody applies to join', on: true, about: 'admin' },
} as const satisfies Record<NotificationCategory, NotificationCategoryInfo>

/** Whether a category is on for somebody who has never touched the settings. */
export const notifiesByDefault = (category: NotificationCategory): boolean =>
  notificationCategoryInfo[category].on

/**
 * The settings table's sections, in the order it renders them.
 *
 * The last one is only ever rendered for an admin, because nobody else is told about
 * anything in it — a switch that cannot do anything reads as a promise (#326).
 */
export const notificationSections = [
  { about: 'you', heading: 'What happens to you' },
  { about: 'else', heading: 'What else is going on' },
  { about: 'admin', heading: 'What you look after' },
] as const satisfies readonly { about: NotificationCategoryInfo['about']; heading: string }[]

export const categoriesAbout = (about: NotificationCategoryInfo['about']): NotificationCategory[] =>
  notificationCategories.filter((category) => notificationCategoryInfo[category].about === about)

/**
 * What a thread can be about (#375).
 *
 * One value today. This is what makes a meal or a ride a value here and a link builder
 * in the web app rather than a migration: `thread.entity_id` holds whichever id it is,
 * and deliberately holds no foreign key, because a thread outlives the dream it was
 * about — withdrawing one says so on the thread instead of deleting the conversation.
 */
export const threadEntityTypes = ['session'] as const
export type ThreadEntityType = (typeof threadEntityTypes)[number]
export const isThreadEntityType = (value: unknown): value is ThreadEntityType =>
  isOneOf(threadEntityTypes, value)

/**
 * What one line on a thread is (#375).
 *
 * `comment` is what a member wrote; the rest are what the app did, and they render as
 * quiet single lines beside it. The kind decides three things at once — the icon, the
 * weight, and whether a second one of the same kind rewrites the first — which is why
 * an entry carries this rather than a notification category. The category is derived
 * from it below, because a stored copy of something derivable is a copy that drifts.
 */
export const threadEntryKinds = [
  'comment',
  'offered',
  'facilitator',
  'helper',
  'renamed',
  'scheduled',
  'edited',
  'withdrawn',
] as const
export type ThreadEntryKind = (typeof threadEntryKinds)[number]
export const isThreadEntryKind = (value: unknown): value is ThreadEntryKind =>
  isOneOf(threadEntryKinds, value)

/**
 * Whether a second of these rewrites the first rather than adding to it.
 *
 * Laying out the grid is a drag every few seconds, and one line per drag is a thread
 * nobody reads. Coalescing happens on the **write** — the newest entry's body and time
 * are rewritten — rather than on the read, so nothing accumulates and the card and the
 * whole thread cannot come to collapse it differently.
 *
 * Only where the same aspect changed again, which is why these are three kinds rather
 * than one `edited`: a rename followed by a move keeps both lines, and fifteen moves
 * keep one.
 */
export const coalesces = (kind: ThreadEntryKind): boolean =>
  kind === 'renamed' || kind === 'scheduled' || kind === 'edited'

/**
 * Which switch the feed offers beside a card, or none.
 *
 * The chip names what the top of the card is, so it has to be a category somebody can
 * switch on and thereby hear about *other people's* dreams. The quiet kinds have none —
 * nothing is ever sent about a dream being moved — and `dream_role` is deliberately not
 * offered either: it is about being put on a dream yourself, so switching it on would
 * change nothing about the card it sat under.
 */
export const entryCategory = (kind: ThreadEntryKind): NotificationCategory | undefined => {
  if (kind === 'comment') return 'dream_comment_any'
  if (kind === 'offered') return 'dream_offered'

  return undefined
}
