import type { FeedKind } from './enums.ts'

import { feedKindsQuery } from './enums.ts'

export const BURN_PARAM = 'burn'

export const DREAM_PARAM = 'dream'

export const MEAL_PARAM = 'meal'

const opening = (eventId: string, open: { dream?: string; meal?: string }): string =>
  [
    `${BURN_PARAM}=${encodeURIComponent(eventId)}`,
    ...(open.dream === undefined ? [] : [`${DREAM_PARAM}=${encodeURIComponent(open.dream)}`]),
    ...(open.meal === undefined ? [] : [`${MEAL_PARAM}=${encodeURIComponent(open.meal)}`]),
  ].join('&')

export const dreamsPage = (eventId: string, open: { dream?: string } = {}): string =>
  `/dreams?${opening(eventId, open)}`

export const dreamPage = (eventId: string, dreamId: string): string => dreamsPage(eventId, { dream: dreamId })

export const schedulePage = (eventId: string, open: { dream?: string; meal?: string } = {}): string =>
  `/schedule?${opening(eventId, open)}`

export const BRING_PARAM = 'item'

export const bringPage = (eventId: string, itemId?: string): string =>
  `/bring?${BURN_PARAM}=${encodeURIComponent(eventId)}${
    itemId === undefined ? '' : `&${BRING_PARAM}=${encodeURIComponent(itemId)}`
  }`

export const POINT_PARAM = 'point'

export const meetingsPage = (eventId: string, pointId?: string): string =>
  `/meetings?${BURN_PARAM}=${encodeURIComponent(eventId)}${
    pointId === undefined ? '' : `&${POINT_PARAM}=${encodeURIComponent(pointId)}`
  }`

export const rolesPage = (eventId: string): string => `/roles?${BURN_PARAM}=${encodeURIComponent(eventId)}`

export const mealsPage = (eventId: string): string => `/meals?${BURN_PARAM}=${encodeURIComponent(eventId)}`

export const membersPage = (eventId?: string): string =>
  eventId === undefined ? '/members' : `/members?${BURN_PARAM}=${encodeURIComponent(eventId)}`

export const profilePage = (accountId: string): string => `/members/${encodeURIComponent(accountId)}`

export const feedPage = (kinds: readonly FeedKind[] = [], burn?: string): string => {
  const filter = feedKindsQuery(kinds)
  if (burn === undefined) return `/feed${filter}`

  return `/feed${filter}${filter === '' ? '?' : '&'}${BURN_PARAM}=${encodeURIComponent(burn)}`
}

export const changelogPage = (): string => '/changelog'

export const formattingPage = (): string => '/formatting'

export const songbookPage = (): string => '/songs'

export const songPage = (songId: string): string => `/songs/${encodeURIComponent(songId)}`

export const OAUTH_OUTCOME_PARAM = 'from'

export const INVITE_PARAM = 'invite'

export const OAUTH_REF_PARAM = 'ref'

export const oauthOutcomes = [
  'refused',
  'misconfigured',
  'unreachable',
  'linked',
  'reached',
  'taken',
  'no-address',
  'address-taken',
] as const

export const signingInOutcomes = ['refused', 'misconfigured', 'unreachable', 'address-taken'] as const

export const applyingOutcomes = ['no-address'] as const

export const linkingOutcomes = [
  'refused',
  'misconfigured',
  'unreachable',
  'linked',
  'reached',
  'taken',
] as const

export type OAuthOutcome = (typeof oauthOutcomes)[number]

// Built by hand rather than with `URLSearchParams`, which this package has no `lib` for — the
// same reason `enums.ts` parses a URL with a regex.
const outcomeQuery = (outcome?: OAuthOutcome, ref?: string): string => {
  if (outcome === undefined) return ''

  const quoted = ref === undefined || ref === '' ? '' : `&${OAUTH_REF_PARAM}=${encodeURIComponent(ref)}`

  return `?${OAUTH_OUTCOME_PARAM}=${outcome}${quoted}`
}

export const applyPage = (outcome?: OAuthOutcome, ref?: string): string =>
  `/apply${outcomeQuery(outcome, ref)}`

export const loginPage = (outcome?: OAuthOutcome, ref?: string): string =>
  `/login${outcomeQuery(outcome, ref)}`

export const detailsPage = (outcome?: OAuthOutcome, ref?: string): string =>
  `/profile${outcomeQuery(outcome, ref)}`

export const notificationsPage = (): string => '/notifications'

export const forgottenPage = (): string => '/forgotten'

export const RESET_PATTERN = '/reset/:token'

export const resetPage = (token: string): string => `/reset/${encodeURIComponent(token)}`

export const INVITE_PATTERN = '/invite/:token'

export const invitePage = (token: string): string => `/invite/${encodeURIComponent(token)}`

export const homePage = (): string => '/'

export const ADMIN_ACCOUNT_PATTERN = '/admin/accounts/:accountId'

export const adminAccountPage = (accountId: string): string =>
  `/admin/accounts/${encodeURIComponent(accountId)}`
