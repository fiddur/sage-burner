import type { StoredAnswers } from '@sage-burner/shared'
import type { SQL } from 'drizzle-orm'
import type { AnySQLiteColumn, SQLiteColumn } from 'drizzle-orm/sqlite-core'

import {
  accountRoles,
  applicationStatuses,
  notificationCategories,
  effortLevels,
  eventOptionKinds,
  formQuestionTypes,
  ICON_TYPES,
  mealRoles,
  mealSlotKinds,
  paymentStatuses,
  placeColors,
  rideKinds,
  tickBoxRequired,
} from '@sage-burner/shared'
import { sql } from 'drizzle-orm'
import {
  blob,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

/** Fixed width is the point: the order CHECKs compare these as strings. */
const isClockTime = (column: SQLiteColumn): SQL =>
  sql`${column} glob '[0-2][0-9]:[0-5][0-9]' and cast(substr(${column}, 1, 2) as integer) < 24`

/**
 * Shape only — `z.iso.date()` rejects `2026-02-30` at the API boundary.
 *
 * Fixed width is load-bearing: the ordering CHECKs compare these as strings, so a raw
 * insert of `'2026-1-2'` would sort wrong and slip past them.
 */
const isIsoDate = (column: SQLiteColumn): SQL =>
  sql`${column} is null or ${column} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`

/**
 * `column IN (...)`, from the same vocabulary the API validates against.
 *
 * Drizzle's `{ enum: [...] }` narrows the TypeScript type and emits no constraint, so
 * without this a bad value arriving by any path but the API is stored happily.
 */
const oneOf = (column: SQLiteColumn, values: readonly string[]): SQL => {
  // `sql.raw`, because interpolation produces a bound parameter and a `?` inside a
  // CHECK is meaningless DDL.
  const literals = values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', ')
  return sql`${column} in (${sql.raw(literals)})`
}

/**
 * The tick-box rule as CHECKs, generated from `tickBoxRequired`.
 *
 * Spelled out in SQL instead, the database would be the one enforcement site not
 * derived from the shared function — so a fifth type with a fixed `required` would be
 * enforced everywhere else and silently not here.
 */
const tickBoxChecks = (table: { type: SQLiteColumn; required: SQLiteColumn }) =>
  formQuestionTypes.flatMap((type) => {
    const must = tickBoxRequired(type)
    if (must === undefined) return []

    const literal = `'${type.replaceAll("'", "''")}'`

    return [
      check(
        `form_question_${type}_required_check`,
        sql`${table.type} <> ${sql.raw(literal)} or ${table.required} = ${sql.raw(must ? '1' : '0')}`,
      ),
    ]
  })

/**
 * Conventions this file keeps:
 *
 * - Ids are application-generated TEXT UUIDs, so one in a URL leaks neither record
 *   counts nor the existence of neighbours.
 * - Dates and timestamps are TEXT in the ISO form they cross the API in, so there is
 *   no conversion layer to get wrong.
 * - Timestamps come from the application, not SQL defaults, so a test can fix the clock.
 * - Enum columns are constrained by the vocabularies in `@sage-burner/shared`.
 */

/**
 * What this deployment calls itself.
 *
 * One row, and the CHECK is what makes that true: no read has to decide which is
 * authoritative. The migration seeds it.
 */
export const installation = sqliteTable(
  'installation',
  {
    id: text('id').notNull(),
    title: text('title').notNull(),
    /**
     * The VAPID keypair push is signed with, minted on first use.
     *
     * Here rather than in the environment so `docker compose up` stays sufficient.
     * Kept rather than derived, because rotating it invalidates every subscription.
     */
    vapid_public_key: text('vapid_public_key'),
    vapid_private_key: text('vapid_private_key'),
    /**
     * The build this installation last booted on, so a redeploy can be noticed (#259).
     *
     * Null until the first boot that looks, which records without announcing: there is
     * no previous version for it to be new against.
     */
    last_build_sha: text('last_build_sha'),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    check('installation_singleton_check', sql`${table.id} = 'installation'`),
    check('installation_title_check', sql`length(trim(${table.title})) > 0`),
  ],
)

/** The id of the one `installation` row. */
export const INSTALLATION_ID = 'installation'

/**
 * The icon an installed copy wears on a home screen (#256).
 *
 * Its own table so the row every page load reads for a title does not carry half a
 * megabyte with it. Nothing here decodes the image — the content type is what the
 * uploader claimed, and the route serving it is what makes that safe.
 */
export const installationIcon = sqliteTable(
  'installation_icon',
  {
    id: text('id').notNull(),
    image: blob('image', { mode: 'buffer' }).notNull(),
    content_type: text('content_type').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    check('installation_icon_singleton_check', sql`${table.id} = 'installation'`),
    check('installation_icon_type_check', oneOf(table.content_type, ICON_TYPES)),
  ],
)

/**
 * The wide picture a shared link draws, and the homepage's banner (#306).
 *
 * Beside `installation_icon` rather than in it: a square logo and a 1200 × 630
 * photograph have nothing but an owner in common. No `content_type` — a banner is a
 * JPEG and can be nothing else.
 */
export const installationBanner = sqliteTable(
  'installation_banner',
  {
    id: text('id').notNull(),
    image: blob('image', { mode: 'buffer' }).notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    check('installation_banner_singleton_check', sql`${table.id} = 'installation'`),
  ],
)

/**
 * Where this installation posts from, when somebody has said (#30).
 *
 * Its own singleton table for the reason the icon has one: an SMTP password is not
 * something to carry along on every page load. No row is the ordinary state.
 *
 * The password is stored as given, because SMTP AUTH sends the password itself — a
 * digest would be one this app could not use.
 */
export const mailSetting = sqliteTable(
  'mail_setting',
  {
    id: text('id').notNull(),
    host: text('host').notNull(),
    port: integer('port').notNull(),
    /** Implicit TLS from the first byte — port 465. STARTTLS needs no flag. */
    secure: integer('secure', { mode: 'boolean' }).notNull(),
    /** Empty for a relay that authenticates by network rather than by password. */
    username: text('username').notNull(),
    password: text('password').notNull(),
    from_email: text('from_email').notNull(),
    /** The name beside `from_email`, or empty for the bare address. */
    from_name: text('from_name').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    check('mail_setting_singleton_check', sql`${table.id} = 'installation'`),
    check('mail_setting_port_check', sql`${table.port} BETWEEN 1 AND 65535`),
    check('mail_setting_host_check', sql`length(trim(${table.host})) > 0`),
    check('mail_setting_from_check', sql`length(trim(${table.from_email})) > 0`),
  ],
)

/** A single burn. Never assume there is only one — the whole point is recurrence. */
export const event = sqliteTable(
  'event',
  {
    id: text('id').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    start_date: text('start_date').notNull(),
    end_date: text('end_date').notNull(),
    start_time: text('start_time').notNull().default('00:00'),
    end_time: text('end_time').notNull().default('23:59'),
    /** Where this one is held. Public: the homepage says it and the share card maps it. */
    location: text('location').notNull().default(''),
    welcome_markdown: text('welcome_markdown').notNull().default(''),
    /** How to pay for this burn. Shown to whoever has not, on the Members page. */
    payment_info_markdown: text('payment_info_markdown').notNull().default(''),
    /** What replaces it once the burn is full — how a place is handed over (#23). */
    transfer_info_markdown: text('transfer_info_markdown').notNull().default(''),
    /** What the Meal page says above its table. Markdown, and any member may rewrite it. */
    meal_intro_markdown: text('meal_intro_markdown').notNull().default(''),
    member_cap: integer('member_cap').notNull(),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    // Mirrors `withEventDateOrder` in the shared schemas.
    check('event_start_date_check', isIsoDate(table.start_date)),
    check('event_end_date_check', isIsoDate(table.end_date)),
    // Times only decide it when the days are equal: across days an earlier clock
    // time is ordinary, and a one-day burn can still be wrongly 22:00 to 10:00.
    check(
      'event_date_order_check',
      sql`${table.end_date} > ${table.start_date} or (${table.end_date} = ${table.start_date} and ${table.end_time} >= ${table.start_time})`,
    ),
    check('event_start_time_check', isClockTime(table.start_time)),
    check('event_end_time_check', isClockTime(table.end_time)),
    check('event_member_cap_check', sql`${table.member_cap} > 0`),
  ],
)

/**
 * The per-event lists a member picks from: where to sleep, what to help with.
 *
 * Per event, unlike `form_question`: these change with the site and the year.
 */
export const eventOption = sqliteTable(
  'event_option',
  {
    id: text('id').notNull(),
    event_id: text('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: eventOptionKinds }).notNull(),
    // Not unique: a reorder swaps positions, and the collision mid-swap is transient.
    order: integer('order').notNull(),
    label: text('label').notNull(),
    /** How many fit, or null for no limit. Only lodging uses it. */
    capacity: integer('capacity'),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index('event_option_event_kind_idx').on(table.event_id, table.kind, table.order),
    check('event_option_kind_check', oneOf(table.kind, eventOptionKinds)),
    check('event_option_order_check', sql`${table.order} >= 0`),
    check('event_option_label_check', sql`length(trim(${table.label})) > 0`),
    // Zero would be a deleted option spelled confusingly; null is no limit.
    check('event_option_capacity_check', sql`${table.capacity} is null or ${table.capacity} > 0`),
  ],
)

/**
 * The application form's questions — **one central set**, not one per event.
 *
 * Rows, not code, so retuning them never needs a redeploy. No `event_id`: somebody
 * applies to the community once, and coming to a burn is a separate act afterwards.
 */
export const formQuestion = sqliteTable(
  'form_question',
  {
    id: text('id').notNull(),
    // Not unique: a reorder swaps positions, and the collision mid-swap is transient.
    order: integer('order').notNull(),
    type: text('type', { enum: formQuestionTypes }).notNull(),
    label: text('label').notNull(),
    help_text: text('help_text'),
    required: integer('required', { mode: 'boolean' }).notNull().default(false),
    /** Reserved for future select/radio types; no question type consumes it yet. */
    options: text('options', { mode: 'json' }).$type<string[] | null>(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index('form_question_order_idx').on(table.order),
    check('form_question_type_check', oneOf(table.type, formQuestionTypes)),
    check('form_question_order_check', sql`${table.order} >= 0`),
    // SQLite has no boolean type, so without this the column accepts 7.
    check('form_question_required_check', sql`${table.required} in (0, 1)`),
    // Here as well as in the API because `required` defaults to false, so an insert
    // that omits it produces the contradictory row without touching a Zod schema.
    ...tickBoxChecks(table),
  ],
)

/**
 * The allergy vocabulary everybody picks from (#254).
 *
 * Global rather than per burn: what somebody cannot eat is a fact about them. Rows
 * rather than an enum so an admin adds one without a deploy, and the free text on
 * `account` stays beside these, because a list is never complete.
 */
export const allergyItem = sqliteTable(
  'allergy_item',
  {
    id: text('id').notNull(),
    // Not unique: a reorder swaps positions, and the collision mid-swap is transient.
    order: integer('order').notNull(),
    label: text('label').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index('allergy_item_order_idx').on(table.order),
    check('allergy_item_order_check', sql`${table.order} >= 0`),
    check('allergy_item_label_check', sql`length(trim(${table.label})) > 0`),
  ],
)

/**
 * What one person cannot eat, as ticks against that list.
 *
 * On the `account`, not an `attendance`: held per burn, a correction would leave every
 * other burn wrong.
 *
 * **No `onDelete` on the item.** SQLite refuses to remove one somebody has ticked and
 * `allergies.ts` turns that into a 409; cascading would silently drop a row that
 * exists to keep somebody safe.
 */
export const accountAllergy = sqliteTable(
  'account_allergy',
  {
    account_id: text('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    item_id: text('item_id')
      .notNull()
      .references(() => allergyItem.id),
  },
  (table) => [primaryKey({ columns: [table.account_id, table.item_id] })],
)

/**
 * Somewhere a dream can happen — **per event**, seeded from a previous burn (#156).
 *
 * The venue outlives the burn but the set in use does not: some spots are summer-only,
 * and one central list gave every grid lanes that do not exist at this burn.
 */
export const place = sqliteTable(
  'place',
  {
    id: text('id').notNull(),
    event_id: text('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    // Not unique: a reorder swaps positions, and the collision mid-swap is transient.
    order: integer('order').notNull(),
    name: text('name').notNull(),
    emoji: text('emoji').notNull(),
    color: text('color', { enum: placeColors }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index('place_event_order_idx').on(table.event_id, table.order),
    check('place_color_check', oneOf(table.color, placeColors)),
    check('place_order_check', sql`${table.order} >= 0`),
    check('place_name_check', sql`length(trim(${table.name})) > 0`),
    check('place_emoji_check', sql`length(trim(${table.emoji})) > 0`),
  ],
)

/**
 * Getting to the burn and back (#26) — `docs/burns.md` has the shape.
 *
 * No contact column: it lives on the account, which is the one place it is kept
 * current.
 */
export const ride = sqliteTable(
  'ride',
  {
    id: text('id').notNull(),
    event_id: text('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    account_id: text('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: rideKinds }).notNull(),
    from: text('from').notNull(),
    when: text('when').notNull(),
    /** Spare room in a car. Zero on a request, where it would mean nothing. */
    seats: integer('seats').notNull().default(0),
    notes: text('notes').notNull().default(''),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    // The one way the board reads: a burn's rows, oldest first within each half.
    index('ride_event_idx').on(table.event_id, table.kind, table.created_at),
    // For the cascade, which without it scans once per row of the account going.
    index('ride_account_idx').on(table.account_id),
    check('ride_kind_check', oneOf(table.kind, rideKinds)),
    check('ride_from_check', sql`length(trim(${table.from})) > 0`),
    check('ride_when_check', sql`length(trim(${table.when})) > 0`),
    check('ride_seats_check', sql`${table.seats} >= 0`),
  ],
)

/** A membership application submitted through the public form. */
export const application = sqliteTable(
  'application',
  {
    id: text('id').notNull(),
    /**
     * The questions as they were worded when asked, each beside its answer.
     *
     * A snapshot rather than references: the questions are rows an admin edits, so one
     * keyed only by id ends up filed under wording nobody was shown — or under a
     * question since deleted, which cannot be labelled at all.
     */
    answers: text('answers', { mode: 'json' }).$type<StoredAnswers>().notNull(),
    status: text('status', { enum: applicationStatuses }).notNull().default('pending'),
    applicant_name: text('applicant_name').notNull(),
    /**
     * Where the invite goes, and the address the account is made under (#30).
     *
     * No CHECK: rows written before this was an address hold phone numbers and
     * Discord handles, and a constraint the existing data fails cannot be migrated in.
     */
    applicant_email: text('applicant_email').notNull(),
    submitted_at: text('submitted_at').notNull(),
    decided_at: text('decided_at'),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index('application_status_idx').on(table.status),
    check('application_status_check', oneOf(table.status, applicationStatuses)),
  ],
)

/** A login identity. Password and passkeys both hang off this. */
export const account = sqliteTable(
  'account',
  {
    id: text('id').notNull(),
    /**
     * Lowercase, enforced by the CHECK below: SQLite's UNIQUE uses BINARY collation, so
     * without it `admin@x.org` and `Admin@X.org` are two accounts for one human.
     *
     * The CHECK guarantees ASCII only, because SQLite's `lower()` does — `Å@x.org`
     * satisfies it unchanged and can coexist with `å@x.org`. **The application must
     * still normalise with `toLowerCase()` before writing or looking up.**
     */
    email: text('email').notNull().unique(),
    /** Nullable: a passkey-only account is legitimate. */
    password_hash: text('password_hash'),
    /** Nullable: the bootstrap admin is created from the CLI with an email and nothing else. */
    name: text('name'),
    contact: text('contact'),
    /**
     * Free text beside the ticks, because a list is never complete.
     *
     * Here rather than per burn: held per attendance, correcting one left the others
     * wrong — on data that exists to keep people safe.
     */
    allergies_notes: text('allergies_notes'),
    /**
     * The invite this account was redeemed from, or null for one made from the CLI.
     *
     * The return type is annotated because `account` and `invite_token` reference each
     * other, and TypeScript cannot infer either in a cycle.
     */
    invite_token_id: text('invite_token_id').references((): AnySQLiteColumn => inviteToken.id),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    check('account_email_lowercase_check', sql`${table.email} = lower(${table.email})`),
    // Single-use for as long as the account exists. Partial, because NULLs compare
    // distinct and every CLI-made account carries none — and deleting the account
    // stops it objecting, which is why redemption stamps `used_at` as well.
    uniqueIndex('account_invite_token_idx')
      .on(table.invite_token_id)
      .where(sql`${table.invite_token_id} is not null`),
  ],
)

/**
 * A registered WebAuthn credential. An account may have several, or none.
 *
 * Passkeys and passwords coexist (#9): both, either, but never neither — which is why
 * removing the last passkey off an account with no password is refused.
 */
export const passkey = sqliteTable(
  'passkey',
  {
    id: text('id').notNull(),
    account_id: text('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    credential_id: text('credential_id').notNull().unique(),
    /** COSE public key, base64url. Not a secret; verifying a signature needs it. */
    public_key: text('public_key').notNull(),
    /** Signature counter, for cloned-authenticator detection. */
    counter: integer('counter').notNull().default(0),
    /**
     * `internal`, `usb`, `hybrid` — comma-separated, null when the browser said nothing.
     *
     * A hint for `excludeCredentials`, so an unknown value is dropped rather than
     * refused: this is not what makes a credential usable.
     */
    transports: text('transports'),
    /** What the member calls it, so a list of three is possible to act on. */
    label: text('label').notNull(),
    created_at: text('created_at').notNull(),
    /** Null until it has signed somebody in. */
    last_used_at: text('last_used_at'),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index('passkey_account_idx').on(table.account_id),
    check('passkey_counter_check', sql`${table.counter} >= 0`),
  ],
)

/**
 * One outstanding ceremony, so an assertion cannot be replayed.
 *
 * A row rather than a signed cookie: single-use is the property that matters and only
 * storage gives it. Deleted when consumed, expired ones swept when a new one is minted.
 *
 * `account_id` is null for a login ceremony, where nobody has said who they are yet.
 */
export const webauthnChallenge = sqliteTable('webauthn_challenge', {
  challenge: text('challenge').primaryKey(),
  account_id: text('account_id').references(() => account.id, { onDelete: 'cascade' }),
  expires_at: text('expires_at').notNull(),
})

/** Coarse access level. No fine-grained permissions in v1. */
export const accountRole = sqliteTable(
  'account_role',
  {
    account_id: text('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    role: text('role', { enum: accountRoles }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.account_id, table.role] }),
    check('account_role_check', oneOf(table.role, accountRoles)),
  ],
)

/**
 * A single-use invitation to join the community.
 *
 * Both paths converge here: an approved application mints one with `application_id`
 * set, a direct invite with it null. No `event_id` — you are let into the community,
 * not into a burn.
 */
export const inviteToken = sqliteTable(
  'invite_token',
  {
    id: text('id').notNull(),
    /**
     * SHA-256 of the invite token, never the token itself, so a leaked backup does not
     * hand out every unexpired invite verbatim.
     *
     * A plain digest is enough: the token is CSPRNG-random, so there is no dictionary
     * to run and no KDF to need.
     */
    token_hash: text('token_hash').notNull().unique(),
    /** Null for an admin-created direct invite with no application behind it. */
    application_id: text('application_id').references(() => application.id, { onDelete: 'set null' }),
    expires_at: text('expires_at').notNull(),
    /** A record of redemption, not what prevents a second: `account_invite_token_idx` is. */
    used_at: text('used_at'),
    /**
     * The admin who minted this invite.
     *
     * No `onDelete`, so an account that has issued invites cannot be deleted: erasing
     * who let whom in would rewrite how the group formed. "Delete my account" therefore
     * has no answer yet — #35 owns that.
     *
     * NO ACTION rather than RESTRICT, so it is checked at the end of the statement and
     * an `event` delete can cascade through its attendances without tripping over it.
     */
    created_by: text('created_by')
      .notNull()
      .references(() => account.id),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    // One invite per application, so an approved application can only ever
    // become one membership. Without this, a double-clicked Approve or a
    // retried request mints two invites for the same application, and since
    // single use is keyed on the token, each redeems into a separate account:
    // one application, two humans.
    //
    // The application can win this race on its own — approving can `UPDATE ...
    // WHERE status = 'pending'` and check the row count — but the same argument
    // used for `account_invite_token_idx` applies: an invariant this
    // load-bearing should not depend on every future caller getting a
    // transaction right.
    //
    // Partial, because NULLs compare distinct in SQLite: direct admin invites
    // carry no application and must stay unconstrained.
    uniqueIndex('invite_token_application_idx')
      .on(table.application_id)
      .where(sql`${table.application_id} is not null`),
  ],
)

// The migrations introducing this table are safe only because both `member` and
// `session` are empty everywhere. `DROP TABLE member` discards rows rather than
// moving them, and the `session` rebuild makes `host_account_id` NOT NULL while
// backfilling nothing — either would fail or lose data against a populated
// database. Nothing outside tests has ever written either table, which is what
// makes that acceptable here and is not a precedent for the next rebuild.

/**
 * One person's participation in one burn (#76).
 *
 * Separate from being in the community: you are approved once, then decide burn by
 * burn. Everything here is about the stay, not the person.
 */
export const attendance = sqliteTable(
  'attendance',
  {
    id: text('id').notNull(),
    event_id: text('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    account_id: text('account_id')
      .notNull()
      .references(() => account.id),
    /** When they said they were coming. The member list is ordered by it (#79). */
    joined_at: text('joined_at').notNull(),
    arrival_date: text('arrival_date'),
    departure_date: text('departure_date'),
    /**
     * Which `event_option` they picked to sleep in, or null for not said. An id rather
     * than text, so anyone can count who is sleeping where.
     *
     * No `onDelete`: removing somewhere people are already sleeping is refused rather
     * than silently unbooking them, and `event-options.ts` makes that a 409.
     */
    lodging_option_id: text('lodging_option_id').references(() => eventOption.id),
    /**
     * Something to help with that the list does not have.
     *
     * Beside the ticked options rather than instead of them: the point of the
     * list is counting, and the point of this is that a list is never complete.
     */
    helping_other: text('helping_other'),
    notes: text('notes'),
    /** Admin-set only. Members can read their own status but never write it. */
    payment_status: text('payment_status', { enum: paymentStatuses }).notNull().default('unpaid'),
    payment_date: text('payment_date'),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    // One attendance per person per burn, which is what makes opting in twice a
    // no-op rather than a second row.
    uniqueIndex('attendance_event_account_idx').on(table.event_id, table.account_id),
    check('attendance_arrival_date_check', isIsoDate(table.arrival_date)),
    check('attendance_departure_date_check', isIsoDate(table.departure_date)),
    check('attendance_payment_date_check', isIsoDate(table.payment_date)),
    check(
      'attendance_stay_order_check',
      sql`${table.arrival_date} is null or ${table.departure_date} is null
          or ${table.departure_date} >= ${table.arrival_date}`,
    ),
    check('attendance_payment_status_check', oneOf(table.payment_status, paymentStatuses)),
  ],
)

/**
 * What one member ticked on the helping-out list.
 *
 * A row per choice rather than a JSON array, because the list exists to be counted.
 *
 * Both sides cascade — unlike lodging, where a bed somebody is in must not vanish
 * underneath them. Nobody is displaced by "kitchen" ceasing to be offered.
 */
export const attendanceHelping = sqliteTable(
  'attendance_helping',
  {
    attendance_id: text('attendance_id')
      .notNull()
      .references(() => attendance.id, { onDelete: 'cascade' }),
    option_id: text('option_id')
      .notNull()
      .references(() => eventOption.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.attendance_id, table.option_id] })],
)

/**
 * A "dream" — a member-offered workshop, ceremony or happening.
 *
 * Named `session` per the original data model, and unrelated to login sessions, which
 * are cookie-based and have no table. A null time slot means offered but not yet
 * scheduled, which is where most sit until the burn.
 */
export const session = sqliteTable(
  'session',
  {
    id: text('id').notNull(),
    event_id: text('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /**
     * Who runs it. Null until somebody is handed it, which is how most start.
     *
     * An `attendance`, so only somebody coming can hold it and leaving the burn empties
     * the spot without a route having to remember to. `set null` rather than cascade:
     * the dream survives its facilitator going.
     */
    facilitator_attendance_id: text('facilitator_attendance_id').references(() => attendance.id, {
      onDelete: 'set null',
    }),
    description: text('description').notNull().default(''),
    /**
     * Whether placing it in the grid leaves it behind to place again.
     *
     * Dropping one writes a copy with this off, so the check-in becomes four
     * mornings. No back-reference to the original: each morning is edited on its own.
     */
    repeatable: integer('repeatable', { mode: 'boolean' }).notNull().default(false),
    time_slot_start: text('time_slot_start'),
    time_slot_end: text('time_slot_end'),
    /**
     * Which lane the dream sits in. Null while it is only offered.
     *
     * No `onDelete`: removing a place that still has dreams in it is refused rather
     * than quietly unscheduling them, and `places.ts` makes that a 409.
     */
    place_id: text('place_id').references(() => place.id),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index('session_event_slot_idx').on(table.event_id, table.time_slot_start),
    // Mirrors `withValidTimeSlot`: a slot is both ends or neither. The
    // ordering half of that rule is not expressible here — comparing ISO
    // timestamps needs instant semantics, not SQLite string comparison — so it
    // stays in the Zod schema. Noted so the asymmetry does not read as an
    // oversight.
    check(
      'session_slot_whole_check',
      sql`(${table.time_slot_start} is null) = (${table.time_slot_end} is null)`,
    ),
  ],
)

/**
 * One browser's permission to be notified — a device, not a person.
 *
 * Keyed by `endpoint`, the push service's own URL for that browser, which is what
 * makes re-subscribing idempotent.
 *
 * `p256dh` and `auth` are what the payload is encrypted to, so a push service relays a
 * notification it cannot read — the only reason routing member business through
 * Google's or Mozilla's infrastructure is acceptable at all.
 */
export const pushSubscription = sqliteTable(
  'push_subscription',
  {
    id: text('id').notNull(),
    account_id: text('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    // One row per browser. Subscribing twice from the same browser is the ordinary
    // case — a page reload does it — and has to update rather than accumulate.
    uniqueIndex('push_subscription_endpoint_idx').on(table.endpoint),
    index('push_subscription_account_idx').on(table.account_id),
  ],
)

/**
 * A lead role for one burn — the spreadsheet's roles tab.
 *
 * Per event: who leads the sauna is a fact about this burn. **Any approved member may
 * add, change or remove one**, which diverges from every other structural edit being
 * admin's — these are co-created events, and at 42 people trust is the mechanism.
 *
 * The lead is an `attendance`, so only somebody coming can hold one and withdrawing
 * vacates it.
 */
export const leadRole = sqliteTable(
  'lead_role',
  {
    id: text('id').notNull(),
    event_id: text('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** Why the role exists. Markdown, like every longer field a member writes. */
    purpose: text('purpose').notNull(),
    /** What doing it involves. Markdown. */
    tasks: text('tasks').notNull(),
    effort_before: text('effort_before', { enum: effortLevels }).notNull(),
    effort_during: text('effort_during', { enum: effortLevels }).notNull(),
    effort_after: text('effort_after', { enum: effortLevels }).notNull(),
    /**
     * How many people are wanted *besides* the lead. Zero means lead-only.
     *
     * Advisory, not a cap: the page shows "2 of 4 wanted" and never refuses
     * somebody who offers. A bed is finite; a pair of hands is not.
     */
    team_size_wanted: integer('team_size_wanted').notNull(),
    /** Vacant until somebody takes it. Cleared if they withdraw from the burn. */
    lead_attendance_id: text('lead_attendance_id').references(() => attendance.id, {
      onDelete: 'set null',
    }),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index('lead_role_event_idx').on(table.event_id),
    check('lead_role_title_check', sql`length(trim(${table.title})) > 0`),
    check('lead_role_team_size_check', sql`${table.team_size_wanted} >= 0`),
    // Generated from the shared vocabulary, so the database is not holding its own
    // copy of the rule — the same argument `place.color` and `form_question.type`
    // make.
    check('lead_role_effort_before_check', oneOf(table.effort_before, effortLevels)),
    check('lead_role_effort_during_check', oneOf(table.effort_during, effortLevels)),
    check('lead_role_effort_after_check', oneOf(table.effort_after, effortLevels)),
  ],
)

/**
 * The Q&A the spreadsheet had a tab for (#28). Why it is per burn: `schemas/faq.ts`.
 *
 * The order matters more than in the other lists: a FAQ is read top to bottom, and
 * the question somebody has first should be the first one they see.
 */
export const faqEntry = sqliteTable(
  'faq_entry',
  {
    id: text('id').notNull(),
    event_id: text('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    order: integer('order').notNull(),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index('faq_entry_event_idx').on(table.event_id, table.order),
    check('faq_entry_question_check', sql`length(trim(${table.question})) > 0`),
  ],
)

/** Somebody on a role's team. An `attendance`, so withdrawing takes them off it. */
export const leadRoleMember = sqliteTable(
  'lead_role_member',
  {
    role_id: text('role_id')
      .notNull()
      .references(() => leadRole.id, { onDelete: 'cascade' }),
    attendance_id: text('attendance_id')
      .notNull()
      .references(() => attendance.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.role_id, table.attendance_id] })],
)

/** Somebody helping run a dream. An `attendance`, so withdrawing takes them off it. */
export const sessionHelper = sqliteTable(
  'session_helper',
  {
    session_id: text('session_id')
      .notNull()
      .references(() => session.id, { onDelete: 'cascade' }),
    attendance_id: text('attendance_id')
      .notNull()
      .references(() => attendance.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.session_id, table.attendance_id] })],
)

/**
 * One ❤️‍🔥 — somebody saying they want this dream to happen.
 *
 * A row per person rather than a counter column: the primary key is then the whole
 * "one each" rule, and the number is derived on every read rather than kept in step.
 */
export const sessionSupport = sqliteTable(
  'session_support',
  {
    session_id: text('session_id')
      .notNull()
      .references(() => session.id, { onDelete: 'cascade' }),
    attendance_id: text('attendance_id')
      .notNull()
      .references(() => attendance.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.session_id, table.attendance_id] })],
)

/**
 * One recurring slot in the kitchen's day — `Lunch 13:00`, `Morning cleanup 9:00`.
 *
 * Per burn, and rarely touched once set: the slots are the burn's shape, like its
 * dates. What they generate is not stored — see `meal_role` for why.
 */
export const mealSlot = sqliteTable(
  'meal_slot',
  {
    id: text('id').notNull(),
    event_id: text('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    // Not unique: a reorder swaps positions, and the collision mid-swap is transient.
    order: integer('order').notNull(),
    label: text('label').notNull(),
    /** `HH:MM`, fixed width, so the CHECK and the sort can both treat it as a string. */
    at: text('at').notNull(),
    kind: text('kind', { enum: mealSlotKinds }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index('meal_slot_event_idx').on(table.event_id, table.order),
    check('meal_slot_order_check', sql`${table.order} >= 0`),
    check('meal_slot_label_check', sql`length(trim(${table.label})) > 0`),
    check('meal_slot_at_check', isClockTime(table.at)),
    check('meal_slot_kind_check', oneOf(table.kind, mealSlotKinds)),
  ],
)

/**
 * One sitting — Monday's lunch, Saturday's dinner.
 *
 * **Generated from the slots, not derived from them.** A derived meal is identical to
 * its template forever: no postponing dinner an hour, no dropping lunch on the day
 * everybody leaves. The slot's values are copied and there is no link back, so
 * renaming a slot leaves the meals it already made alone.
 */
export const meal = sqliteTable(
  'meal',
  {
    id: text('id').notNull(),
    event_id: text('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    /** `YYYY-MM-DD`. */
    date: text('date').notNull(),
    /** `HH:MM`, fixed width, so the CHECK and the sort can both treat it as a string. */
    at: text('at').notNull(),
    label: text('label').notNull(),
    kind: text('kind', { enum: mealSlotKinds }).notNull(),
    /** The sheet's "Food idea?" column. Optional, and nobody is bound by it. */
    food_idea: text('food_idea').notNull().default(''),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index('meal_event_idx').on(table.event_id, table.date, table.at),
    // What makes generating safe to run again: it fills in what is missing and
    // touches nothing else, so adding a slot or extending the burn is one click and
    // never a duplicate. Two lunches on one day is a mistake, not a plan.
    uniqueIndex('meal_event_date_label_idx').on(table.event_id, table.date, table.label),
    check('meal_label_check', sql`length(trim(${table.label})) > 0`),
    check('meal_at_check', isClockTime(table.at)),
    check('meal_kind_check', oneOf(table.kind, mealSlotKinds)),
    check('meal_date_check', sql`${table.date} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`),
  ],
)

/**
 * Somebody on one meal — its lead, a helper, or on the cleanup crew.
 *
 * The primary key is the whole "once each" rule: a member may be a helper *and* on
 * cleanup for one meal, but not either twice.
 */
export const mealRole = sqliteTable(
  'meal_role',
  {
    meal_id: text('meal_id')
      .notNull()
      .references(() => meal.id, { onDelete: 'cascade' }),
    attendance_id: text('attendance_id')
      .notNull()
      .references(() => attendance.id, { onDelete: 'cascade' }),
    role: text('role', { enum: mealRoles }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.meal_id, table.attendance_id, table.role] }),
    check('meal_role_role_check', oneOf(table.role, mealRoles)),
    // One lead per meal. The other two are unbounded — nothing runs out of people
    // willing to wash up, and a cap would only be something for an admin to raise.
    uniqueIndex('meal_role_lead_idx')
      .on(table.meal_id)
      .where(sql`${table.role} = 'lead'`),
  ],
)

/**
 * Somebody's picture for the circle in the corner.
 *
 * In the database, because the container has no writable path but the data volume and
 * `docker compose up` has to stay sufficient. Its own table, because `account` is read
 * on nearly every request and tens of kilobytes there would be read by all of them to
 * be used by none.
 *
 * Sparse, so every read is a `leftJoin`. `updated_at` is the version in the URL, so a
 * new picture is a new URL and no cache has to be persuaded.
 */
export const accountAvatar = sqliteTable(
  'account_avatar',
  {
    account_id: text('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    image: blob('image', { mode: 'buffer' }).notNull(),
    content_type: text('content_type').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.account_id] }),
    // The three the upload route accepts. A CHECK as well, because the constraint
    // exists for writes that do not come through the API.
    check('account_avatar_type_check', oneOf(table.content_type, ['image/jpeg', 'image/png', 'image/webp'])),
  ],
)

// Deliberately no relations() / defineRelations() block.
//
// Those exist to power the relational query builder (`db.query.x.findMany({
// with: ... })`). We use explicit joins instead: the queries here are small,
// joins make the emitted SQL obvious, and it keeps our dependency on Drizzle's
// still-moving 1.0 API surface to the parts we actually need.

/**
 * One thing that happened to somebody (#248).
 *
 * A record rather than only a push: the bell says what happened while you were away
 * and whether you have looked. The push is a copy of this, not the other way round.
 */
export const notification = sqliteTable(
  'notification',
  {
    id: text('id').notNull(),
    account_id: text('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    category: text('category', { enum: notificationCategories }).notNull(),
    body: text('body').notNull(),
    /** Where clicking it goes. Null for anything with no page of its own. */
    link: text('link'),
    created_at: text('created_at').notNull(),
    /** Null until the bell has been opened. What makes it go grey again. */
    seen_at: text('seen_at'),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index('notification_account_idx').on(table.account_id, table.created_at),
    check('notification_category_check', oneOf(table.category, notificationCategories)),
  ],
)

/**
 * A category somebody has explicitly chosen, either way.
 *
 * A row means "this person said" and absence means "they have not", which is the only
 * reading that works for the categories that default on *and* the ones that default
 * off (#259). Nothing is seeded, so an account made tomorrow gets today's defaults.
 */
export const notificationSetting = sqliteTable(
  'notification_setting',
  {
    account_id: text('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    category: text('category', { enum: notificationCategories }).notNull(),
    /** The bell and the push, whose default is `notificationCategoryInfo`'s `on`. */
    enabled: integer('enabled', { mode: 'boolean' }).notNull(),
    /**
     * Off for every category until somebody asks (#30). Defaulted in SQL as well, so an
     * upgrade never switches on a channel that reaches somebody's inbox.
     */
    email: integer('email', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.account_id, table.category] }),
    check('notification_setting_category_check', oneOf(table.category, notificationCategories)),
  ],
)

/**
 * What has been going on, for the feed to show (#303). `docs/the-app.md` has the why.
 *
 * One row per event rather than one per person told, which is the whole difference
 * from `notification`. `category` is a notification category because the page's chip
 * switches one on.
 *
 * **Cascades with the burn, which is the whole retention rule**: an audit log grows
 * without bound, and this is bounded by something that already ends.
 */
export const activity = sqliteTable(
  'activity',
  {
    id: text('id').notNull(),
    event_id: text('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    category: text('category', { enum: notificationCategories }).notNull(),
    /** The line, in the third person — the same wording the notification carries. */
    body: text('body').notNull(),
    link: text('link'),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    // Newest first across every burn, which is the one way this is read.
    index('activity_recent_idx').on(table.created_at),
    // Not for a read — nothing filters by burn — but for the cascade, which without
    // it scans the table once per row of the burn being deleted (#333).
    index('activity_event_idx').on(table.event_id),
    check('activity_category_check', oneOf(table.category, notificationCategories)),
  ],
)
