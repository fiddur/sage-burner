export const BURN_PARAM = 'burn'

export const DREAM_PARAM = 'dream'

export const dreamPage = (eventId: string, dreamId: string): string =>
  `/dreams?${BURN_PARAM}=${encodeURIComponent(eventId)}&${DREAM_PARAM}=${encodeURIComponent(dreamId)}`

export const profilePage = (accountId: string): string => `/members/${encodeURIComponent(accountId)}`

export const OAUTH_OUTCOME_PARAM = 'from'

export const oauthOutcomes = ['unlinked', 'refused', 'linked', 'taken'] as const

export type OAuthOutcome = (typeof oauthOutcomes)[number]

export const loginPage = (outcome?: OAuthOutcome): string =>
  outcome === undefined ? '/login' : `/login?${OAUTH_OUTCOME_PARAM}=${outcome}`

export const detailsPage = (outcome?: OAuthOutcome): string =>
  outcome === undefined ? '/profile' : `/profile?${OAUTH_OUTCOME_PARAM}=${outcome}`
