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

/**
 * The ways somebody may say they can be reached (#388).
 *
 * A fixed vocabulary, and fixed for a concrete reason rather than tidiness: rendering
 * one needs the app to know what it is. A handle has to become a URL, and only the kind
 * says how — `@wren` on Instagram and `@wren@chaos.social` on Mastodon build different
 * links, and a Discord username builds none at all. A free-text kind could produce
 * neither an icon nor a link, which is why the escape hatch is `link` — a label and a
 * URL somebody types — rather than an open list.
 *
 * Adding one is a line here **and** a migration: `kind` carries a CHECK listing the
 * vocabulary and SQLite cannot alter a CHECK in place, so the table is rebuilt. Nothing
 * checks that the two agree, so a kind added here alone passes Zod and the type checker
 * and then fails the CHECK against a database that ran the old migration.
 */
export const connectionKinds = [
  'email',
  'phone',
  'signal',
  'whatsapp',
  'messenger',
  'discord',
  'instagram',
  'tiktok',
  'mastodon',
  'link',
] as const

export type ConnectionKind = (typeof connectionKinds)[number]

export const isConnectionKind = (value: unknown): value is ConnectionKind => isOneOf(connectionKinds, value)

export interface ConnectionKindInfo {
  /** What the row is called, in the editor and beside the value. */
  label: string
  icon: string
  /** What the box asks for, so nobody has to guess the shape. */
  hint: string
  /**
   * Whether the person names it themselves. Only `link` does — everything else is a
   * network whose name is the label.
   */
  labelled: boolean
  /**
   * The address to build, or nothing where the network has no such thing.
   *
   * Discord is the one that matters here: a username is a string you paste into Discord's
   * own search and there is no profile URL to point at, so the page has to offer something
   * to copy instead of an anchor. A kind added without an answer to this would otherwise
   * render a dead link.
   */
  href: (value: string) => string | undefined
}

/** Digits, `+` kept, so a number typed with spaces or dashes still dials. */
const dialled = (value: string): string => `+${value.replaceAll(/\D/gu, '')}`

/**
 * `@user@instance` split into the address its own server serves.
 *
 * The value carries the server, unlike every other handle here, so this is the one that
 * has to be read rather than dropped into a template.
 */
const mastodonHref = (value: string): string | undefined => {
  const [, user, instance] = /^@?([^@\s]+)@([^@\s]+)$/u.exec(value.trim()) ?? []
  if (user === undefined || instance === undefined) return undefined

  return `https://${instance}/@${user}`
}

/**
 * An `http(s)` URL in its parts, or nothing if it is not one.
 *
 * One function because this pattern was written out three times and carried the same defect
 * in each: **`\\` has to end the authority**, since WHATWG treats it as `/` for a special
 * scheme. `https://evil.example\\.facebook.com/wren` is host `evil.example` and path
 * `/.facebook.com/wren` to a browser, while an authority taken up to the first `/?#` ends
 * `.facebook.com` and passes a host check — so a link to somewhere else read as Facebook's.
 *
 * **`authority`, not a hostname**, and named that way because it is not one: userinfo and a
 * port ride along, so `user@facebook.com` and `facebook.com:443` both fail a host check that
 * an end-anchored pattern would pass on the host alone. That is the safe direction — a
 * refusal, never an acceptance — and stripping them here would mean hand-rolling the part of
 * URL parsing that caused this defect in the first place. Callers wanting a true hostname
 * should say so and get it right rather than have it implied by a field name.
 *
 * A regex rather than `URL`: this package has no platform in its `lib`, deliberately —
 * everything in it has to typecheck the same for the backend and for the browser, and `URL`
 * is in neither. Verified, not assumed: `new URL` here is `TS2304: Cannot find name 'URL'`.
 */
const urlParts = (
  value: string,
): { scheme: string; authority: string; path: string; query: string } | undefined => {
  const [, scheme, authority, path = '', query = ''] =
    /^(https?):\/\/([^\s/\\?#]+)(?:[/\\]([^\s?#]*))?(?:\?([^\s#]*))?(?:#.*)?$/iu.exec(value.trim()) ?? []

  return authority === undefined || scheme === undefined ? undefined : { scheme, authority, path, query }
}

/**
 * The handle inside a pasted profile URL, or nothing if that is not what this is.
 *
 * People paste. Autofill pastes, and every "copy link" button hands over a URL rather
 * than a handle — so a value kept whole builds `instagram.com/https://instagram.com/wren`
 * and points at nobody. Only the first path segment is taken, so a link carrying `?hl=en`
 * or a trailing slash reduces to the same handle.
 */
const handleIn = (value: string, host: RegExp): string | undefined => {
  const parts = urlParts(value)
  if (parts === undefined || !host.test(parts.authority)) return undefined

  // Split on `\` as well, the residue of the same divergence: a browser reads
  // `instagram.com/a\b/c` as segment `a`, so taking `a\b` as the handle would store one
  // nobody has.
  const [first] = parts.path.split(/[/\\]/u).filter((part) => part !== '')

  return first === undefined ? undefined : first.replace(/^@/u, '')
}

const FACEBOOK_HOST = /(^|\.)facebook\.com$/iu

/**
 * Path segments a Facebook URL can start with that are not somebody's handle.
 *
 * `handleIn` takes the first segment, which for `profile.php?id=…` and for
 * `/people/Name/123456/` is the segment itself — stored, that renders `m.me/profile.php`
 * and points at nobody.
 */
const NOT_A_HANDLE = new Set(['profile.php', 'people'])

/**
 * The numeric id out of a `profile.php?id=` link, or nothing.
 *
 * Its own function so the host is anchored the way `handleIn` anchors it. Written inline
 * the two branches of `connectionValue` disagreed about what Facebook is: `[^\s/]*` before
 * `facebook.com` accepts `notfacebook.com`, and eats a whole authority, so
 * `https://evil.example?x=facebook.com/profile.php?id=123` matched as well.
 */
const facebookNumericId = (value: string): string | undefined => {
  const parts = urlParts(value)
  if (parts === undefined || !FACEBOOK_HOST.test(parts.authority)) return undefined
  const { path, query } = parts
  if (path.toLowerCase() !== 'profile.php') return undefined

  const [, id] = /(?:^|&)id=(\d+)(?:&|$)/u.exec(query) ?? []

  return id
}

/**
 * `@user@instance` out of a pasted Mastodon URL, or nothing if that is not what this is.
 *
 * Any instance, so the host cannot be matched against a list — a Mastodon URL is recognised by
 * its shape instead: one path segment, and that segment an `@handle`. Through `urlParts` like
 * the other three, so there is one spelling of an authority here rather than a fourth to
 * remember when the first three are corrected.
 */
const mastodonHandle = (value: string): string | undefined => {
  const parts = urlParts(value)
  const [, user] = /^@([^\s/\\]+)[/\\]?$/u.exec(parts?.path ?? '') ?? []

  return user === undefined || parts === undefined ? undefined : `@${user}@${parts.authority}`
}

/**
 * What is actually stored for a kind, whatever was typed or pasted into the box.
 *
 * Normalising on the way in rather than at render, because the value is read as text as
 * well as followed as a link — the profile page prints it beside the icon — and because
 * `unique(account_id, kind, value)` should refuse `wren` and `@wren` as one handle rather
 * than keep both. It does not weaken "store what was typed": the reason for that is a
 * network changing its domain being one line here instead of a migration, and reducing a
 * pasted URL to the handle is what makes that true.
 */
export const connectionValue = (kind: ConnectionKind, value: string): string => {
  const trimmed = value.trim()

  if (kind === 'messenger') {
    const numeric = facebookNumericId(trimmed)
    if (numeric !== undefined) return numeric

    const handle = handleIn(trimmed, FACEBOOK_HOST)
    if (handle !== undefined && !NOT_A_HANDLE.has(handle.toLowerCase())) return handle
    // A Facebook URL whose first segment is not a handle — `?id=abc`, `?myid=42`, a
    // `/people/Name/123/` link — is kept whole rather than reduced to that segment. It is
    // visibly wrong, which beats storing `profile.php` as somebody's Messenger name.
    if (handle !== undefined) return trimmed

    return trimmed.replace(/^@/u, '')
  }
  if (kind === 'instagram') return handleIn(trimmed, /(^|\.)instagram\.com$/iu) ?? trimmed.replace(/^@/u, '')
  if (kind === 'tiktok') return handleIn(trimmed, /(^|\.)tiktok\.com$/iu) ?? trimmed.replace(/^@/u, '')
  if (kind === 'mastodon') return mastodonHandle(trimmed) ?? trimmed

  return trimmed
}

/**
 * Somebody's Facebook page, from the handle they typed for Messenger (#393).
 *
 * Two shapes, and both have to be kept: an account with a vanity name is
 * `facebook.com/wren`, and one without is only ever `facebook.com/profile.php?id=<digits>`,
 * which is what `connectionValue` stores the digits of. Never from a linked sign-in —
 * `docs/accounts.md` says why an app-scoped id points at nobody.
 */
export const facebookProfileUrl = (value: string): string =>
  /^\d+$/u.test(value.trim())
    ? `https://facebook.com/profile.php?id=${value.trim()}`
    : `https://facebook.com/${value.trim()}`

/**
 * A URL Facebook itself answered, if it is one worth putting in an `href` (#405).
 *
 * `link` arrives from `user_link` rather than from anything somebody typed, and it is still
 * checked here — it ends up as a link on a page other members read, so the one thing it must
 * not be able to become is a link somewhere else. The host is anchored the way
 * `facebookNumericId` anchors its own, against the same mistake: matching `facebook.com`
 * loosely accepts `notfacebook.com` and `https://evil.example?x=facebook.com/wren` alike.
 *
 * `https` only, for `isProfileUrl`'s reason — `javascript:` is what is being refused.
 */
export const facebookProfileLink = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined

  const trimmed = value.trim()
  const parts = urlParts(trimmed)
  if (parts === undefined || parts.scheme.toLowerCase() !== 'https') return undefined

  return FACEBOOK_HOST.test(parts.authority) ? trimmed : undefined
}

/**
 * A URL somebody typed, if it is one worth putting in an `href`.
 *
 * `https` alone, and stricter than `markdown.ts`'s link check on purpose: that governs
 * prose, where a relative path and a `mailto:` are ordinary, while this field exists to
 * hold somebody's page elsewhere. `javascript:` is the thing being refused.
 */
export const isProfileUrl = (value: string): boolean => /^https:\/\/[^\s/$.?#][^\s]*$/iu.test(value.trim())

export const connectionKindInfo = {
  email: {
    label: 'Email',
    icon: '✉️',
    hint: 'you@example.org',
    labelled: false,
    href: (value) => `mailto:${value.trim()}`,
  },
  phone: {
    label: 'Phone',
    icon: '📞',
    hint: '+46 70 123 45 67',
    labelled: false,
    href: (value) => `tel:${dialled(value)}`,
  },
  signal: {
    label: 'Signal',
    icon: '🔒',
    hint: 'The number you are on Signal with',
    labelled: false,
    // A number is not enough to build a signal.me link — that carries a key — so this
    // is one to copy into Signal rather than to follow.
    href: () => undefined,
  },
  whatsapp: {
    label: 'WhatsApp',
    icon: '💬',
    hint: '+46 70 123 45 67',
    labelled: false,
    href: (value) => `https://wa.me/${dialled(value).slice(1)}`,
  },
  messenger: {
    label: 'Messenger',
    icon: '🗨️',
    hint: 'your Facebook name, or the number in your profile link',
    labelled: false,
    // Facebook as a *way to be reached* is Messenger. Looking at somebody's Facebook page is a
    // different act and not a contact detail — the profile page builds that from this same
    // typed value, because a linked sign-in answers with an app-scoped id that points at
    // nobody outside the installation's own Meta app (#393).
    href: (value) => `https://m.me/${value.trim()}`,
  },
  discord: {
    label: 'Discord',
    icon: '🎮',
    hint: 'your username',
    labelled: false,
    // Discord has no profile URL at all: a username is a string you search for.
    href: () => undefined,
  },
  instagram: {
    label: 'Instagram',
    icon: '📷',
    hint: '@handle',
    labelled: false,
    href: (value) => `https://instagram.com/${value.trim().replace(/^@/u, '')}`,
  },
  tiktok: {
    label: 'TikTok',
    icon: '🎵',
    hint: '@handle',
    labelled: false,
    href: (value) => `https://tiktok.com/@${value.trim().replace(/^@/u, '')}`,
  },
  mastodon: {
    label: 'Mastodon',
    icon: '🐘',
    hint: '@you@instance.social',
    labelled: false,
    href: mastodonHref,
  },
  link: {
    label: 'Somewhere else',
    icon: '🔗',
    hint: 'https://…',
    labelled: true,
    href: (value) => (isProfileUrl(value) ? value.trim() : undefined),
  },
} as const satisfies Record<ConnectionKind, ConnectionKindInfo>

/**
 * Where a stored connection points, or nothing to follow.
 *
 * One entry point rather than reaching into the table at each call site, so a kind whose
 * value cannot be made into a link is handled the same way everywhere.
 */
export const connectionHref = (kind: ConnectionKind, value: string): string | undefined =>
  connectionKindInfo[kind].href(value)

/**
 * The places somebody can sign in from, besides a password and a passkey (#393).
 *
 * Two rather than one, and that is what settles the shape: a `provider` column is not
 * speculation when there are two rows in it on the day it lands. Discord first because
 * the community being replaced already lives there, so everybody has an account and
 * recognises the button — and its OAuth2 costs nothing but an app in the developer
 * portal, where Facebook's wants app review.
 *
 * Adding one is a line here **and** a migration, for the reason `connectionKinds` gives:
 * `provider` carries a CHECK listing the vocabulary and SQLite cannot alter one in place.
 */
export const oauthProviders = ['discord', 'facebook'] as const

export type OAuthProvider = (typeof oauthProviders)[number]

export const isOAuthProvider = (value: unknown): value is OAuthProvider => isOneOf(oauthProviders, value)

export interface OAuthProviderInfo {
  /** What the button says after "Continue with". */
  label: string
  icon: string
}

export const oauthProviderInfo = {
  discord: { label: 'Discord', icon: '🎮' },
  facebook: { label: 'Facebook', icon: '📘' },
} as const satisfies Record<OAuthProvider, OAuthProviderInfo>

/**
 * What a callback is for, which the state row carries rather than the URL.
 *
 * The same provider round trip does both jobs and they end differently: `sign-in` looks
 * for an identity and refuses when there is none, `link` writes one for the account
 * already signed in. Put in the URL it would be a caller's claim about which; in the row
 * it is what the app decided when it minted the state.
 */
export const oauthIntents = ['sign-in', 'link'] as const

export type OAuthIntent = (typeof oauthIntents)[number]
