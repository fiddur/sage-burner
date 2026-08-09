/**
 * Where a link lands *in the app*, as opposed to `routes.ts`, which is the API.
 *
 * Small on purpose: only the paths more than one side builds. A notification's link is
 * written by the backend, the feed's card builds its own, and the page reads the query
 * back — three spellings of one URL, and the one that drifts is a link that quietly
 * opens the wrong thing. Everything reachable from the nav is a literal where it is
 * used, because only one place ever writes it.
 *
 * Zod-free like `enums.ts`, so the web can import it at runtime.
 */

/** Which burn a burn-agnostic page should be about. `burn.tsx` is what reads it. */
export const BURN_PARAM = 'burn'

/** Which dream the Dreams page should open its panel on. */
export const DREAM_PARAM = 'dream'

/**
 * The Dreams page, with one dream open.
 *
 * Both parameters, always: the page is burn-scoped and the panel is not reachable
 * without saying which burn's dreams to load first.
 */
export const dreamPage = (eventId: string, dreamId: string): string =>
  `/dreams?${BURN_PARAM}=${encodeURIComponent(eventId)}&${DREAM_PARAM}=${encodeURIComponent(dreamId)}`

/**
 * Somebody's page (#389).
 *
 * Here rather than as a literal because more than one side builds it: every name in the
 * app links to it, and a notification saying somebody handed you a job has an obvious
 * person to point at.
 */
export const profilePage = (accountId: string): string => `/members/${encodeURIComponent(accountId)}`

/**
 * How a provider round trip tells the page how it went (#393).
 *
 * The callback is a top-level navigation, so the only channel back into the app is the URL
 * it lands on — and both sides need the spelling: the backend writes it and the page reads
 * it, which is what this file is for.
 *
 * A reason rather than a sentence, because the wording belongs to the page and the reason
 * belongs to the route. `unlinked` in particular has to say nothing about whether an
 * account exists: signing in from a provider nobody has linked and signing in from one that
 * is not somebody's are the same answer.
 */
export const OAUTH_OUTCOME_PARAM = 'from'

export const oauthOutcomes = ['unlinked', 'refused', 'linked', 'taken'] as const

export type OAuthOutcome = (typeof oauthOutcomes)[number]

/** Where somebody lands after signing in from a provider, or failing to. */
export const loginPage = (outcome?: OAuthOutcome): string =>
  outcome === undefined ? '/login' : `/login?${OAUTH_OUTCOME_PARAM}=${outcome}`

/** Where somebody lands after adding a way in, or failing to. */
export const detailsPage = (outcome?: OAuthOutcome): string =>
  outcome === undefined ? '/profile' : `/profile?${OAUTH_OUTCOME_PARAM}=${outcome}`
