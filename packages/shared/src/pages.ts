import type { FeedKind } from './enums.ts'

import { feedKindsQuery } from './enums.ts'

export const BURN_PARAM = 'burn'

export const DREAM_PARAM = 'dream'

export const dreamPage = (eventId: string, dreamId: string): string =>
  `/dreams?${BURN_PARAM}=${encodeURIComponent(eventId)}&${DREAM_PARAM}=${encodeURIComponent(dreamId)}`

export const BRING_PARAM = 'item'

export const bringPage = (eventId: string, itemId?: string): string =>
  `/bring?${BURN_PARAM}=${encodeURIComponent(eventId)}${
    itemId === undefined ? '' : `&${BRING_PARAM}=${encodeURIComponent(itemId)}`
  }`

export const profilePage = (accountId: string): string => `/members/${encodeURIComponent(accountId)}`

export const feedPage = (kinds: readonly FeedKind[] = [], burn?: string): string => {
  const filter = feedKindsQuery(kinds)
  if (burn === undefined) return `/feed${filter}`

  return `/feed${filter}${filter === '' ? '?' : '&'}${BURN_PARAM}=${encodeURIComponent(burn)}`
}

export const changelogPage = (): string => '/changelog'

export const songbookPage = (): string => '/songs'

export const songPage = (songId: string): string => `/songs/${encodeURIComponent(songId)}`

export const OAUTH_OUTCOME_PARAM = 'from'

/** Which invite a provider round trip set off from, so the callback can spend it (#512). */
export const INVITE_PARAM = 'invite'

// What the page tells an organiser to quote: the request id, which is `reqId` on the log line
// that carries the provider's own words.
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

/**
 * Which page an outcome can land on, so each page's copy can be exhaustive over its own half
 * rather than over a list it has to remember to filter. Anything that goes wrong at the provider
 * lands wherever the round trip started, so three appear in both.
 */
export const signingInOutcomes = ['refused', 'misconfigured', 'unreachable', 'address-taken'] as const

/** `no-address` lands here rather than on login: a provider that gave none cannot sign anybody in. */
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

export const homePage = (): string => '/'

/**
 * Where a provider round trip that set off from an invite comes back to when the link itself
 * is the thing that went wrong — the invite page is what can say which way.
 */
export const invitePage = (token: string, status?: string): string =>
  `/invite/${encodeURIComponent(token)}${status === undefined ? '' : `?${OAUTH_OUTCOME_PARAM}=${encodeURIComponent(status)}`}`
