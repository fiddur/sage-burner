const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && values.some((candidate) => candidate === value)

export const accountRoles = ['admin', 'member'] as const
export type AccountRole = (typeof accountRoles)[number]
export const isAccountRole = (value: unknown): value is AccountRole => isOneOf(accountRoles, value)

export const placeColors = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'grey'] as const
export type PlaceColor = (typeof placeColors)[number]
export const isPlaceColor = (value: unknown): value is PlaceColor => isOneOf(placeColors, value)

export const rideKinds = ['needs', 'offers'] as const
export type RideKind = (typeof rideKinds)[number]

export const eventOptionKinds = ['lodging', 'helping'] as const
export type EventOptionKind = (typeof eventOptionKinds)[number]
export const isEventOptionKind = (value: unknown): value is EventOptionKind =>
  isOneOf(eventOptionKinds, value)

export const mealSlotKinds = ['meal', 'chore'] as const
export type MealSlotKind = (typeof mealSlotKinds)[number]
export const isMealSlotKind = (value: unknown): value is MealSlotKind => isOneOf(mealSlotKinds, value)

export const mealRoles = ['lead', 'helper', 'cleanup'] as const
export type MealRole = (typeof mealRoles)[number]
export const isMealRole = (value: unknown): value is MealRole => isOneOf(mealRoles, value)

export const applicationStatuses = ['pending', 'approved', 'rejected'] as const
export type ApplicationStatus = (typeof applicationStatuses)[number]
export const isApplicationStatus = (value: unknown): value is ApplicationStatus =>
  isOneOf(applicationStatuses, value)

export const formQuestionTypes = ['text', 'textarea', 'checkbox', 'agreement'] as const
export type FormQuestionType = (typeof formQuestionTypes)[number]
export const isFormQuestionType = (value: unknown): value is FormQuestionType =>
  isOneOf(formQuestionTypes, value)

export const tickBoxRequired = (type: string): boolean | undefined => {
  if (type === 'agreement') return true
  if (type === 'checkbox') return false

  return undefined
}

export const inviteStatuses = ['outstanding', 'used', 'expired', 'revoked', 'full'] as const
export type InviteStatus = (typeof inviteStatuses)[number]
export const isInviteStatus = (value: unknown): value is InviteStatus => isOneOf(inviteStatuses, value)

export const inviteStatusOf = (
  invite: {
    expires_at: string
    used_at: string | null
    revoked_at?: string | null
    max_uses?: number | null
    redemptions?: number
  },
  now: Date,
): InviteStatus => {
  if (invite.used_at !== null) return 'used'
  if (invite.revoked_at != null) return 'revoked'
  if (Date.parse(invite.expires_at) <= now.getTime()) return 'expired'
  if (invite.max_uses != null && (invite.redemptions ?? 0) >= invite.max_uses) return 'full'

  return 'outstanding'
}

export const effortLevels = ['none', 'low', 'medium', 'high'] as const
export type EffortLevel = (typeof effortLevels)[number]
export const isEffortLevel = (value: unknown): value is EffortLevel => isOneOf(effortLevels, value)

export const paymentStatuses = ['unpaid', 'paid'] as const
export type PaymentStatus = (typeof paymentStatuses)[number]
export const isPaymentStatus = (value: unknown): value is PaymentStatus => isOneOf(paymentStatuses, value)

export const digestChoices = ['daily', 'weekly', 'off'] as const
export type DigestChoice = (typeof digestChoices)[number]
export const isDigestChoice = (value: unknown): value is DigestChoice => isOneOf(digestChoices, value)

/**
 * What an account that has never said gets. A stored row is an explicit choice, so absence is
 * "has not said" and the default lives here — the rule `notificationCategoryInfo` already follows.
 */
export const DEFAULT_DIGEST: DigestChoice = 'daily'

export const digestChoiceInfo = {
  daily: { label: 'Every day' },
  weekly: { label: 'Every week' },
  off: { label: 'Never' },
} as const satisfies Record<DigestChoice, { label: string }>

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
  'introduction_written',
  'introduction_comment',
  'introduction_comment_any',
  'post_written',
  'post_comment',
  'post_comment_any',
  'song_added',
  'song_comment',
  'song_comment_any',
  'bring_added',
  'bring_answered',
  'bring_role',
  'bring_comment',
  'bring_comment_any',
  'point_raised',
  'point_decided',
  'point_comment',
  'point_comment_any',
  'meeting_scheduled',
  'meeting_comment',
  'meeting_comment_any',
  'mentioned',
  'lead_role_added',
  'lead_role_filled',
  'new_version',
  'application',
  'application_news',
] as const
export type NotificationCategory = (typeof notificationCategories)[number]

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
  dream_comment: { label: 'Somebody comments on a dream you are part of', on: true, about: 'you' },
  dream_comment_any: { label: 'Somebody comments on any dream', on: false, about: 'else' },
  member_joined: { label: 'Somebody says they are coming', on: false, about: 'else' },
  introduction_written: { label: 'Somebody says who they are', on: false, about: 'else' },
  introduction_comment: { label: 'Somebody comments on your own card', on: true, about: 'you' },
  introduction_comment_any: { label: 'Somebody comments on anybody’s card', on: false, about: 'else' },
  post_written: { label: 'Somebody announces something', on: false, about: 'else' },
  post_comment: { label: 'Somebody comments on something you announced', on: true, about: 'you' },
  post_comment_any: { label: 'Somebody comments on an announcement', on: false, about: 'else' },
  song_added: { label: 'A song goes into the songbook', on: false, about: 'else' },
  song_comment: { label: 'Somebody comments on a song you put in', on: true, about: 'you' },
  song_comment_any: { label: 'Somebody comments on any song', on: false, about: 'else' },
  bring_added: { label: 'Somebody wants or offers something to bring', on: false, about: 'else' },
  bring_answered: { label: 'Somebody brings what you asked for', on: true, about: 'you' },
  bring_role: { label: 'Put on or taken off bringing something', on: true, about: 'you' },
  bring_comment: {
    label: 'Somebody comments on something you asked for or are bringing',
    on: true,
    about: 'you',
  },
  bring_comment_any: { label: 'Somebody comments on anything on the bring list', on: false, about: 'else' },
  point_raised: { label: 'Somebody raises a talking point', on: false, about: 'else' },
  point_decided: { label: 'A talking point is decided', on: false, about: 'else' },
  point_comment: { label: 'Somebody comments on a point you raised', on: true, about: 'you' },
  point_comment_any: { label: 'Somebody comments on any talking point', on: false, about: 'else' },
  meeting_scheduled: { label: 'A meeting is put in the diary', on: true, about: 'else' },
  meeting_comment: { label: 'Somebody comments on a meeting you put in the diary', on: true, about: 'you' },
  meeting_comment_any: { label: 'Somebody comments on any meeting', on: false, about: 'else' },
  mentioned: { label: 'Somebody names you', on: true, about: 'you' },
  lead_role_added: { label: 'A lead role is added', on: false, about: 'else' },
  lead_role_filled: { label: 'Somebody takes the lead of a role', on: false, about: 'else' },
  new_version: { label: 'A new version of the app is out', on: false, about: 'else' },
  application: { label: 'Somebody applies to join', on: true, about: 'admin' },
  application_news: { label: 'News about your application', on: true, about: 'you' },
} as const satisfies Record<NotificationCategory, NotificationCategoryInfo>

export const notifiesByDefault = (category: NotificationCategory): boolean =>
  notificationCategoryInfo[category].on

export const notificationSections = [
  { about: 'you', heading: 'What happens to you' },
  { about: 'else', heading: 'What else is going on' },
  { about: 'admin', heading: 'What you look after' },
] as const satisfies readonly { about: NotificationCategoryInfo['about']; heading: string }[]

export const categoriesAbout = (about: NotificationCategoryInfo['about']): NotificationCategory[] =>
  notificationCategories.filter((category) => notificationCategoryInfo[category].about === about)

export const threadEntityTypes = [
  'session',
  'attendance',
  'post',
  'song',
  'bring',
  'point',
  'meeting',
] as const
export type ThreadEntityType = (typeof threadEntityTypes)[number]
export const isThreadEntityType = (value: unknown): value is ThreadEntityType =>
  isOneOf(threadEntityTypes, value)

export const feedKinds = ['activity', ...threadEntityTypes] as const
export type FeedKind = (typeof feedKinds)[number]
export const isFeedKind = (value: unknown): value is FeedKind => isOneOf(feedKinds, value)

export const feedKindLabel = {
  activity: 'Burns',
  session: 'Dreams',
  attendance: 'People',
  post: 'Posts',
  song: 'Songs',
  bring: 'Bring',
  point: 'Points',
  meeting: 'Meetings',
} as const satisfies Record<FeedKind, string>

export const KINDS_PARAM = 'kinds'

export const feedKindsFrom = (raw: unknown): FeedKind[] => [
  ...new Set((typeof raw === 'string' ? raw : '').split(',').filter(isFeedKind)),
]

export const feedKindsQuery = (kinds: readonly FeedKind[]): string => {
  const asked = [...new Set(kinds)]

  return asked.length === 0 || asked.length === feedKinds.length
    ? ''
    : `?${KINDS_PARAM}=${asked.map((kind) => encodeURIComponent(kind)).join(',')}`
}

export const threadEntryKinds = [
  'comment',
  'offered',
  'joined',
  'introduced',
  'posted',
  'added',
  'restored',
  'facilitator',
  'helper',
  'renamed',
  'scheduled',
  'edited',
  'withdrawn',
  'raised',
  'decided',
] as const
export type ThreadEntryKind = (typeof threadEntryKinds)[number]
export const isThreadEntryKind = (value: unknown): value is ThreadEntryKind =>
  isOneOf(threadEntryKinds, value)

export const coalesces = (kind: ThreadEntryKind): boolean =>
  kind === 'renamed' || kind === 'scheduled' || kind === 'edited' || kind === 'introduced'

const sessionCategory = (kind: ThreadEntryKind): NotificationCategory | undefined => {
  if (kind === 'comment') return 'dream_comment_any'
  if (kind === 'offered') return 'dream_offered'

  return undefined
}

const attendanceCategory = (kind: ThreadEntryKind): NotificationCategory | undefined => {
  if (kind === 'comment') return 'introduction_comment_any'
  if (kind === 'introduced') return 'introduction_written'
  if (kind === 'joined') return 'member_joined'

  return undefined
}

const postCategory = (kind: ThreadEntryKind): NotificationCategory | undefined => {
  if (kind === 'comment') return 'post_comment_any'
  if (kind === 'posted' || kind === 'edited') return 'post_written'

  return undefined
}

const songCategory = (kind: ThreadEntryKind): NotificationCategory | undefined => {
  if (kind === 'comment') return 'song_comment_any'
  if (kind === 'added' || kind === 'edited' || kind === 'restored') return 'song_added'

  return undefined
}

const bringCategory = (kind: ThreadEntryKind): NotificationCategory | undefined => {
  if (kind === 'comment') return 'bring_comment_any'
  if (kind === 'added' || kind === 'edited') return 'bring_added'

  return undefined
}

const pointCategory = (kind: ThreadEntryKind): NotificationCategory | undefined => {
  if (kind === 'comment') return 'point_comment_any'
  if (kind === 'raised') return 'point_raised'
  if (kind === 'decided') return 'point_decided'

  return undefined
}

const meetingCategory = (kind: ThreadEntryKind): NotificationCategory | undefined => {
  if (kind === 'comment') return 'meeting_comment_any'
  if (kind === 'scheduled') return 'meeting_scheduled'

  return undefined
}

const categoriesFor = {
  session: sessionCategory,
  attendance: attendanceCategory,
  post: postCategory,
  song: songCategory,
  bring: bringCategory,
  point: pointCategory,
  meeting: meetingCategory,
} as const satisfies Record<ThreadEntityType, (kind: ThreadEntryKind) => NotificationCategory | undefined>

export const entryCategory = (
  entity: ThreadEntityType,
  kind: ThreadEntryKind,
): NotificationCategory | undefined => categoriesFor[entity](kind)

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
  label: string
  icon: string
  hint: string
  labelled: boolean
  href: (value: string) => string | undefined
}

const dialled = (value: string): string => `+${value.replaceAll(/\D/gu, '')}`

const mastodonHref = (value: string): string | undefined => {
  const [, user, instance] = /^@?([^@\s/\\]+)@([^@\s/\\]+)$/u.exec(value.trim()) ?? []
  if (user === undefined || instance === undefined) return undefined

  return `https://${instance}/@${user}`
}

const urlParts = (
  value: string,
): { scheme: string; authority: string; path: string; query: string } | undefined => {
  const [, scheme, authority, path = '', query = ''] =
    /^(https?):\/\/([^\s/\\?#]+)(?:[/\\]([^\s?#]*))?(?:\?([^\s#]*))?(?:#.*)?$/iu.exec(value.trim()) ?? []

  return authority === undefined || scheme === undefined ? undefined : { scheme, authority, path, query }
}

const handleIn = (value: string, host: RegExp): string | undefined => {
  const parts = urlParts(value)
  if (parts === undefined || !host.test(parts.authority)) return undefined

  const [first] = parts.path.split(/[/\\]/u).filter((part) => part !== '')

  return first === undefined ? undefined : first.replace(/^@/u, '')
}

const FACEBOOK_HOST = /(^|\.)facebook\.com$/iu

const NOT_A_HANDLE = new Set(['profile.php', 'people'])

const facebookNumericId = (value: string): string | undefined => {
  const parts = urlParts(value)
  if (parts === undefined || !FACEBOOK_HOST.test(parts.authority)) return undefined
  const { path, query } = parts
  if (path.toLowerCase() !== 'profile.php') return undefined

  const [, id] = /(?:^|&)id=(\d+)(?:&|$)/u.exec(query) ?? []

  return id
}

const mastodonHandle = (value: string): string | undefined => {
  const parts = urlParts(value)
  const [, user] = /^@([^\s/\\]+)[/\\]?$/u.exec(parts?.path ?? '') ?? []

  return user === undefined || parts === undefined ? undefined : `@${user}@${parts.authority}`
}

export const connectionValue = (kind: ConnectionKind, value: string): string => {
  const trimmed = value.trim()

  if (kind === 'messenger') {
    const numeric = facebookNumericId(trimmed)
    if (numeric !== undefined) return numeric

    const handle = handleIn(trimmed, FACEBOOK_HOST)
    if (handle !== undefined && !NOT_A_HANDLE.has(handle.toLowerCase())) return handle
    if (handle !== undefined) return trimmed

    return trimmed.replace(/^@/u, '')
  }
  if (kind === 'instagram') return handleIn(trimmed, /(^|\.)instagram\.com$/iu) ?? trimmed.replace(/^@/u, '')
  if (kind === 'tiktok') return handleIn(trimmed, /(^|\.)tiktok\.com$/iu) ?? trimmed.replace(/^@/u, '')
  if (kind === 'mastodon') return mastodonHandle(trimmed) ?? trimmed

  return trimmed
}

export const facebookProfileUrl = (value: string): string =>
  /^\d+$/u.test(value.trim())
    ? `https://facebook.com/profile.php?id=${value.trim()}`
    : `https://facebook.com/${value.trim()}`

// `\` must end the authority: WHATWG reads it as `/` for a special scheme, so
// `https://evil.example\.facebook.com/wren` is host `evil.example` to a browser.
export const facebookProfileLink = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined

  const trimmed = value.trim()
  const parts = urlParts(trimmed)
  if (parts === undefined || parts.scheme.toLowerCase() !== 'https') return undefined

  return FACEBOOK_HOST.test(parts.authority) ? trimmed : undefined
}

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
    href: (value) => `https://m.me/${value.trim()}`,
  },
  discord: {
    label: 'Discord',
    icon: '🎮',
    hint: 'your username',
    labelled: false,
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

export const connectionHref = (kind: ConnectionKind, value: string): string | undefined =>
  connectionKindInfo[kind].href(value)

export const oauthProviders = ['discord', 'facebook'] as const

export type OAuthProvider = (typeof oauthProviders)[number]

export const isOAuthProvider = (value: unknown): value is OAuthProvider => isOneOf(oauthProviders, value)

export interface OAuthProviderInfo {
  label: string
  icon: string
}

export const oauthProviderInfo = {
  discord: { label: 'Discord', icon: '🎮' },
  facebook: { label: 'Facebook', icon: '📘' },
} as const satisfies Record<OAuthProvider, OAuthProviderInfo>

export const oauthIntents = ['sign-in', 'link'] as const

export type OAuthIntent = (typeof oauthIntents)[number]

export const inviteKinds = ['single', 'group'] as const

export type InviteKind = (typeof inviteKinds)[number]
