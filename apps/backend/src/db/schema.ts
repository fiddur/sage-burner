import type { SongLink, StoredAnswers } from '@sage-burner/shared'
import type { SQL } from 'drizzle-orm'
import type { AnySQLiteColumn, SQLiteColumn } from 'drizzle-orm/sqlite-core'

import {
  accountRoles,
  applicationStatuses,
  connectionKinds,
  effortLevels,
  eventOptionKinds,
  formQuestionTypes,
  ICON_TYPES,
  IMAGE_TYPES,
  mealRoles,
  mealSlotKinds,
  notificationCategories,
  oauthIntents,
  oauthProviders,
  paymentStatuses,
  placeColors,
  rideKinds,
  threadEntityTypes,
  threadEntryKinds,
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

const isClockTime = (column: SQLiteColumn): SQL =>
  sql`${column} glob '[0-2][0-9]:[0-5][0-9]' and cast(substr(${column}, 1, 2) as integer) < 24`

const isIsoDate = (column: SQLiteColumn): SQL =>
  sql`${column} is null or ${column} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`

const oneOf = (column: SQLiteColumn, values: readonly string[]): SQL => {
  const literals = values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', ')
  return sql`${column} in (${sql.raw(literals)})`
}

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

export const installation = sqliteTable(
  'installation',
  {
    id: text('id').notNull(),
    title: text('title').notNull(),
    map_url: text('map_url'),
    vapid_public_key: text('vapid_public_key'),
    vapid_private_key: text('vapid_private_key'),
    last_build_sha: text('last_build_sha'),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    check('installation_singleton_check', sql`${table.id} = 'installation'`),
    check('installation_title_check', sql`length(trim(${table.title})) > 0`),
  ],
)

export const INSTALLATION_ID = 'installation'

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

export const mailSetting = sqliteTable(
  'mail_setting',
  {
    id: text('id').notNull(),
    host: text('host').notNull(),
    port: integer('port').notNull(),
    secure: integer('secure', { mode: 'boolean' }).notNull(),
    username: text('username').notNull(),
    password: text('password').notNull(),
    from_email: text('from_email').notNull(),
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
    location: text('location').notNull().default(''),
    welcome_markdown: text('welcome_markdown').notNull().default(''),
    payment_info_markdown: text('payment_info_markdown').notNull().default(''),
    transfer_info_markdown: text('transfer_info_markdown').notNull().default(''),
    meal_intro_markdown: text('meal_intro_markdown').notNull().default(''),
    member_cap: integer('member_cap').notNull(),
    // Keyed by this and deliberately not the id, which the public homepage hands to anybody.
    feed_token: text('feed_token'),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    uniqueIndex('event_feed_token_idx')
      .on(table.feed_token)
      .where(sql`${table.feed_token} is not null`),
    check('event_start_date_check', isIsoDate(table.start_date)),
    check('event_end_date_check', isIsoDate(table.end_date)),
    check(
      'event_date_order_check',
      sql`${table.end_date} > ${table.start_date} or (${table.end_date} = ${table.start_date} and ${table.end_time} >= ${table.start_time})`,
    ),
    check('event_start_time_check', isClockTime(table.start_time)),
    check('event_end_time_check', isClockTime(table.end_time)),
    check('event_member_cap_check', sql`${table.member_cap} > 0`),
  ],
)

export const eventOption = sqliteTable(
  'event_option',
  {
    id: text('id').notNull(),
    event_id: text('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: eventOptionKinds }).notNull(),
    order: integer('order').notNull(),
    label: text('label').notNull(),
    capacity: integer('capacity'),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index('event_option_event_kind_idx').on(table.event_id, table.kind, table.order),
    check('event_option_kind_check', oneOf(table.kind, eventOptionKinds)),
    check('event_option_order_check', sql`${table.order} >= 0`),
    check('event_option_label_check', sql`length(trim(${table.label})) > 0`),
    check('event_option_capacity_check', sql`${table.capacity} is null or ${table.capacity} > 0`),
  ],
)

export const formQuestion = sqliteTable(
  'form_question',
  {
    id: text('id').notNull(),
    order: integer('order').notNull(),
    type: text('type', { enum: formQuestionTypes }).notNull(),
    label: text('label').notNull(),
    help_text: text('help_text'),
    required: integer('required', { mode: 'boolean' }).notNull().default(false),
    options: text('options', { mode: 'json' }).$type<string[] | null>(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index('form_question_order_idx').on(table.order),
    check('form_question_type_check', oneOf(table.type, formQuestionTypes)),
    check('form_question_order_check', sql`${table.order} >= 0`),
    check('form_question_required_check', sql`${table.required} in (0, 1)`),
    ...tickBoxChecks(table),
  ],
)

export const allergyItem = sqliteTable(
  'allergy_item',
  {
    id: text('id').notNull(),
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

// No `onDelete`: SQLite refuses to remove an item somebody has ticked, and `allergies.ts`
// turns that into a 409.
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

export const place = sqliteTable(
  'place',
  {
    id: text('id').notNull(),
    event_id: text('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
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
    seats: integer('seats').notNull().default(0),
    notes: text('notes').notNull().default(''),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index('ride_event_idx').on(table.event_id, table.created_at),
    index('ride_account_idx').on(table.account_id),
    check('ride_kind_check', oneOf(table.kind, rideKinds)),
    check('ride_from_check', sql`length(trim(${table.from})) > 0`),
    check('ride_when_check', sql`length(trim(${table.when})) > 0`),
    check('ride_seats_check', sql`${table.seats} >= 0`),
  ],
)

export const application = sqliteTable(
  'application',
  {
    id: text('id').notNull(),
    answers: text('answers', { mode: 'json' }).$type<StoredAnswers>().notNull(),
    status: text('status', { enum: applicationStatuses }).notNull().default('pending'),
    account_id: text('account_id').references(() => account.id, { onDelete: 'cascade' }),
    applicant_name: text('applicant_name').notNull(),
    applicant_email: text('applicant_email').notNull(),
    submitted_at: text('submitted_at').notNull(),
    decided_at: text('decided_at'),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index('application_status_idx').on(table.status),
    uniqueIndex('application_account_idx').on(table.account_id),
    check('application_status_check', oneOf(table.status, applicationStatuses)),
  ],
)

export const account = sqliteTable(
  'account',
  {
    id: text('id').notNull(),
    email: text('email').notNull().unique(),
    password_hash: text('password_hash'),
    name: text('name'),
    contact: text('contact'),
    allergies_notes: text('allergies_notes'),
    introduction: text('introduction'),
    invite_token_id: text('invite_token_id').references((): AnySQLiteColumn => inviteToken.id),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    check('account_email_lowercase_check', sql`${table.email} = lower(${table.email})`),
    uniqueIndex('account_invite_token_idx')
      .on(table.invite_token_id)
      .where(sql`${table.invite_token_id} is not null`),
  ],
)

export const passkey = sqliteTable(
  'passkey',
  {
    id: text('id').notNull(),
    account_id: text('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    credential_id: text('credential_id').notNull().unique(),
    public_key: text('public_key').notNull(),
    counter: integer('counter').notNull().default(0),
    transports: text('transports'),
    label: text('label').notNull(),
    created_at: text('created_at').notNull(),
    last_used_at: text('last_used_at'),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index('passkey_account_idx').on(table.account_id),
    check('passkey_counter_check', sql`${table.counter} >= 0`),
  ],
)

export const webauthnChallenge = sqliteTable('webauthn_challenge', {
  challenge: text('challenge').primaryKey(),
  account_id: text('account_id').references(() => account.id, { onDelete: 'cascade' }),
  expires_at: text('expires_at').notNull(),
})

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

export const inviteToken = sqliteTable(
  'invite_token',
  {
    id: text('id').notNull(),
    token_hash: text('token_hash').notNull().unique(),
    application_id: text('application_id').references(() => application.id, { onDelete: 'set null' }),
    expires_at: text('expires_at').notNull(),
    used_at: text('used_at'),
    // No `onDelete`, so NO ACTION applies and an account that has issued invites cannot be
    // deleted (#35). NO ACTION rather than RESTRICT is what lets an `event` delete cascade
    // through its attendances without tripping over this mid-cascade.
    created_by: text('created_by')
      .notNull()
      .references(() => account.id),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    uniqueIndex('invite_token_application_idx')
      .on(table.application_id)
      .where(sql`${table.application_id} is not null`),
  ],
)

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
    joined_at: text('joined_at').notNull(),
    arrival_date: text('arrival_date'),
    departure_date: text('departure_date'),
    // No `onDelete`: somewhere people are already sleeping is refused, not silently unbooked.
    lodging_option_id: text('lodging_option_id').references(() => eventOption.id),
    helping_other: text('helping_other'),
    notes: text('notes'),
    payment_status: text('payment_status', { enum: paymentStatuses }).notNull().default('unpaid'),
    payment_date: text('payment_date'),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
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

export const session = sqliteTable(
  'session',
  {
    id: text('id').notNull(),
    event_id: text('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    facilitator_attendance_id: text('facilitator_attendance_id').references(() => attendance.id, {
      onDelete: 'set null',
    }),
    description: text('description').notNull().default(''),
    repeatable: integer('repeatable', { mode: 'boolean' }).notNull().default(false),
    time_slot_start: text('time_slot_start'),
    time_slot_end: text('time_slot_end'),
    // No `onDelete`: a place with dreams in it is refused rather than quietly unscheduled.
    place_id: text('place_id').references(() => place.id),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index('session_event_slot_idx').on(table.event_id, table.time_slot_start),
    check(
      'session_slot_whole_check',
      sql`(${table.time_slot_start} is null) = (${table.time_slot_end} is null)`,
    ),
  ],
)

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
    uniqueIndex('push_subscription_endpoint_idx').on(table.endpoint),
    index('push_subscription_account_idx').on(table.account_id),
  ],
)

export const leadRole = sqliteTable(
  'lead_role',
  {
    id: text('id').notNull(),
    event_id: text('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    purpose: text('purpose').notNull(),
    tasks: text('tasks').notNull(),
    effort_before: text('effort_before', { enum: effortLevels }).notNull(),
    effort_during: text('effort_during', { enum: effortLevels }).notNull(),
    effort_after: text('effort_after', { enum: effortLevels }).notNull(),
    team_size_wanted: integer('team_size_wanted').notNull(),
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
    check('lead_role_effort_before_check', oneOf(table.effort_before, effortLevels)),
    check('lead_role_effort_during_check', oneOf(table.effort_during, effortLevels)),
    check('lead_role_effort_after_check', oneOf(table.effort_after, effortLevels)),
  ],
)

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

export const mealSlot = sqliteTable(
  'meal_slot',
  {
    id: text('id').notNull(),
    event_id: text('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    order: integer('order').notNull(),
    label: text('label').notNull(),
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

export const meal = sqliteTable(
  'meal',
  {
    id: text('id').notNull(),
    event_id: text('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    at: text('at').notNull(),
    label: text('label').notNull(),
    kind: text('kind', { enum: mealSlotKinds }).notNull(),
    food_idea: text('food_idea').notNull().default(''),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index('meal_event_idx').on(table.event_id, table.date, table.at),
    uniqueIndex('meal_event_date_label_idx').on(table.event_id, table.date, table.label),
    check('meal_label_check', sql`length(trim(${table.label})) > 0`),
    check('meal_at_check', isClockTime(table.at)),
    check('meal_kind_check', oneOf(table.kind, mealSlotKinds)),
    check('meal_date_check', sql`${table.date} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`),
  ],
)

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
    uniqueIndex('meal_role_lead_idx')
      .on(table.meal_id)
      .where(sql`${table.role} = 'lead'`),
  ],
)

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
    check('account_avatar_type_check', oneOf(table.content_type, ['image/jpeg', 'image/png', 'image/webp'])),
  ],
)

export const notification = sqliteTable(
  'notification',
  {
    id: text('id').notNull(),
    account_id: text('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    category: text('category', { enum: notificationCategories }).notNull(),
    body: text('body').notNull(),
    link: text('link'),
    created_at: text('created_at').notNull(),
    seen_at: text('seen_at'),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index('notification_account_idx').on(table.account_id, table.created_at),
    check('notification_category_check', oneOf(table.category, notificationCategories)),
  ],
)

export const notificationSetting = sqliteTable(
  'notification_setting',
  {
    account_id: text('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    category: text('category', { enum: notificationCategories }).notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull(),
    email: integer('email', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.account_id, table.category] }),
    check('notification_setting_category_check', oneOf(table.category, notificationCategories)),
  ],
)

export const activity = sqliteTable(
  'activity',
  {
    id: text('id').notNull(),
    event_id: text('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    category: text('category', { enum: notificationCategories }).notNull(),
    body: text('body').notNull(),
    link: text('link'),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index('activity_recent_idx').on(table.created_at),
    index('activity_event_idx').on(table.event_id),
    check('activity_category_check', oneOf(table.category, notificationCategories)),
  ],
)

// `event_id` is nullable for the songbook, whose threads belong to no burn and so outlive
// every one of them — `docs/the-app.md` has why the book is global.
export const thread = sqliteTable(
  'thread',
  {
    id: text('id').notNull(),
    event_id: text('event_id').references(() => event.id, { onDelete: 'cascade' }),
    entity_type: text('entity_type', { enum: threadEntityTypes }).notNull(),
    entity_id: text('entity_id').notNull(),
    subject_account_id: text('subject_account_id').references(() => account.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    uniqueIndex('thread_entity_idx').on(table.entity_type, table.entity_id),
    index('thread_event_idx').on(table.event_id),
    uniqueIndex('thread_subject_idx').on(table.subject_account_id, table.event_id),
    check('thread_entity_type_check', oneOf(table.entity_type, threadEntityTypes)),
  ],
)

export const threadEntry = sqliteTable(
  'thread_entry',
  {
    id: text('id').notNull(),
    thread_id: text('thread_id')
      .notNull()
      .references(() => thread.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: threadEntryKinds }).notNull(),
    seq: integer('seq').notNull(),
    author_account_id: text('author_account_id').references(() => account.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    created_at: text('created_at').notNull(),
    edited_at: text('edited_at'),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index('thread_entry_seq_idx').on(table.thread_id, table.seq),
    check('thread_entry_kind_check', oneOf(table.kind, threadEntryKinds)),
    check(
      'thread_entry_comment_author_check',
      sql`${table.kind} <> 'comment' or ${table.author_account_id} is not null`,
    ),
  ],
)

/**
 * Account-keyed, unlike `session_support`: the songbook belongs to no burn, so there is no
 * attendance to hang a heart on, and nothing about liking a post or welcoming somebody needs
 * scoping to one. A dream's heart stays `session_support` — one heart, one table (#479).
 */
export const threadSupport = sqliteTable(
  'thread_support',
  {
    thread_id: text('thread_id')
      .notNull()
      .references(() => thread.id, { onDelete: 'cascade' }),
    account_id: text('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.thread_id, table.account_id] })],
)

/**
 * Absence means the default, the way `notification_setting` already works: no row and the
 * participants logic decides, `enabled` follows a card without having spoken on it, and disabled
 * mutes one you would otherwise be a participant of (#480).
 */
export const threadFollow = sqliteTable(
  'thread_follow',
  {
    thread_id: text('thread_id')
      .notNull()
      .references(() => thread.id, { onDelete: 'cascade' }),
    account_id: text('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    enabled: integer('enabled', { mode: 'boolean' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.thread_id, table.account_id] })],
)

export const image = sqliteTable(
  'image',
  {
    id: text('id').notNull(),
    bytes: blob('bytes', { mode: 'buffer' }).notNull(),
    content_type: text('content_type').notNull(),
    uploaded_by: text('uploaded_by')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    check('image_type_check', oneOf(table.content_type, IMAGE_TYPES)),
    index('image_uploader_idx').on(table.uploaded_by),
  ],
)

export const accountConnection = sqliteTable(
  'account_connection',
  {
    id: text('id').notNull(),
    account_id: text('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: connectionKinds }).notNull(),
    value: text('value').notNull(),
    label: text('label').notNull().default(''),
    order: integer('order').notNull(),
    from_provider: text('from_provider', { enum: oauthProviders }),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    check('account_connection_kind_check', oneOf(table.kind, connectionKinds)),
    check('account_connection_value_check', sql`length(trim(${table.value})) > 0`),
    uniqueIndex('account_connection_unique_idx').on(table.account_id, table.kind, table.value),
    index('account_connection_account_idx').on(table.account_id, table.order),
  ],
)

export const post = sqliteTable(
  'post',
  {
    id: text('id').notNull(),
    event_id: text('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    author_account_id: text('author_account_id').references(() => account.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    withdrawn_at: text('withdrawn_at'),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    check('post_title_check', sql`length(trim(${table.title})) > 0`),
  ],
)

// No `event_id`: a song outlives any one burn, so the book is global.
export const song = sqliteTable(
  'song',
  {
    id: text('id').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    capo: integer('capo'),
    links: text('links', { mode: 'json' }).$type<SongLink[]>().notNull().default([]),
    author_account_id: text('author_account_id').references(() => account.id, { onDelete: 'set null' }),
    deleted_at: text('deleted_at'),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index('song_title_idx').on(table.title),
    check('song_title_check', sql`length(trim(${table.title})) > 0`),
    check('song_capo_check', sql`${table.capo} is null or (${table.capo} >= 0 and ${table.capo} <= 11)`),
  ],
)

export const songCategory = sqliteTable(
  'song_category',
  {
    id: text('id').notNull(),
    order: integer('order').notNull(),
    label: text('label').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index('song_category_order_idx').on(table.order),
    check('song_category_order_check', sql`${table.order} >= 0`),
    check('song_category_label_check', sql`length(trim(${table.label})) > 0`),
  ],
)

export const songInCategory = sqliteTable(
  'song_in_category',
  {
    song_id: text('song_id')
      .notNull()
      .references(() => song.id, { onDelete: 'cascade' }),
    category_id: text('category_id')
      .notNull()
      .references(() => songCategory.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.song_id, table.category_id] }),
    index('song_in_category_category_idx').on(table.category_id),
  ],
)

export const oauthSetting = sqliteTable(
  'oauth_setting',
  {
    provider: text('provider', { enum: oauthProviders }).notNull(),
    client_id: text('client_id').notNull(),
    client_secret: text('client_secret').notNull(),
    ask_profile_link: integer('ask_profile_link', { mode: 'boolean' }).notNull().default(false),
    updated_at: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.provider] }),
    check('oauth_setting_provider_check', oneOf(table.provider, oauthProviders)),
    check('oauth_setting_client_id_check', sql`length(trim(${table.client_id})) > 0`),
  ],
)

export const accountIdentity = sqliteTable(
  'account_identity',
  {
    id: text('id').notNull(),
    account_id: text('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    provider: text('provider', { enum: oauthProviders }).notNull(),
    subject: text('subject').notNull(),
    profile_url: text('profile_url'),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    check('account_identity_provider_check', oneOf(table.provider, oauthProviders)),
    uniqueIndex('account_identity_subject_idx').on(table.provider, table.subject),
    uniqueIndex('account_identity_account_idx').on(table.provider, table.account_id),
  ],
)

export const oauthState = sqliteTable(
  'oauth_state',
  {
    state: text('state').notNull(),
    provider: text('provider', { enum: oauthProviders }).notNull(),
    intent: text('intent', { enum: oauthIntents }).notNull(),
    nonce: text('nonce').notNull(),
    account_id: text('account_id').references(() => account.id, { onDelete: 'cascade' }),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.state] }),
    check('oauth_state_provider_check', oneOf(table.provider, oauthProviders)),
    check('oauth_state_intent_check', oneOf(table.intent, oauthIntents)),
    check(
      'oauth_state_link_account_check',
      sql`${table.intent} <> 'link' or ${table.account_id} is not null`,
    ),
  ],
)
