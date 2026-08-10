export const BURN_PARAM = 'burn'

export const DREAM_PARAM = 'dream'

export const dreamPage = (eventId: string, dreamId: string): string =>
  `/dreams?${BURN_PARAM}=${encodeURIComponent(eventId)}&${DREAM_PARAM}=${encodeURIComponent(dreamId)}`

export const profilePage = (accountId: string): string => `/members/${encodeURIComponent(accountId)}`

export const OAUTH_OUTCOME_PARAM = 'from'

// What the page tells an organiser to quote: the request id, which is `reqId` on the log line
// that carries the provider's own words.
export const OAUTH_REF_PARAM = 'ref'

export const oauthOutcomes = [
  'unlinked',
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

export const loginPage = (outcome?: OAuthOutcome, ref?: string): string =>
  `/login${outcomeQuery(outcome, ref)}`

export const detailsPage = (outcome?: OAuthOutcome, ref?: string): string =>
  `/profile${outcomeQuery(outcome, ref)}`
