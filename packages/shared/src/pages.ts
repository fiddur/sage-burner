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
