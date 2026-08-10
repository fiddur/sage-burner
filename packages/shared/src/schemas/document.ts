import { z } from 'zod'

/**
 * A markdown file that ships with the image and is served at a URL of its own (#419).
 *
 * Three endpoints answer exactly this and differ in nothing else, so the shape is written
 * once. What each one is *for* stays on its own name below, because that is the part a
 * reader needs and the part that would go stale if it were merged away.
 *
 * **Served rather than bundled**, which all three need for different reasons: a tab that has
 * just been told there is a new version is still running the old bundle, and a reviewer at
 * Meta opens the policy and the terms as a stranger with no bundle at all.
 *
 * Empty where the image has none — a page saying so, rather than a 404 or a container that
 * refuses to start, since nothing here is load-bearing at boot.
 */
export const documentResponseSchema = z.object({ markdown: z.string() })
export type DocumentResponse = z.infer<typeof documentResponseSchema>

/**
 * `GET /api/changelog` — what changed, as the notification's page shows it (#325).
 *
 * The file the repository keeps rather than anything derived from git: a changelog is
 * written for the people using the app, and a list of commit subjects is not that.
 *
 * Public, like `/api/version`: it is release notes for an app whose homepage is public,
 * holds nobody's data, and ships in a public image either way.
 */
export const changelogResponseSchema = documentResponseSchema
export type ChangelogResponse = DocumentResponse

/**
 * `GET /api/privacy` — what Facebook's app review asks for a URL to (#402).
 *
 * **Public, and that is the whole point.** A reviewer at Meta opens it as a stranger, and so
 * does anybody deciding whether to apply. A privacy policy behind a login is not one.
 *
 * It is also where Meta's **data deletion instructions** URL points (#419). Instructions
 * rather than a deletion callback: the callback is an unauthenticated POST defended only by
 * an HMAC over the app secret, and it would have to delete an identity that
 * `anotherWayInSurvives` refuses to let go — locking somebody out of a burn they have paid
 * for. Somebody signed in on their own Your details page hits none of that.
 */
export const privacyResponseSchema = documentResponseSchema
export type PrivacyResponse = DocumentResponse

/**
 * `GET /api/terms` — the second URL Meta's Basic Settings asks for (#419).
 *
 * Public for the privacy policy's reason, and it says the thing that is genuinely surprising
 * about this app: the agreement is with the people who invited you, not with the software or
 * anybody who wrote it. There is no company behind a self-hosted gathering.
 *
 * **Not admin-editable**, which is #402's argument unchanged: nothing would validate the
 * text, and an installation that emptied it would fail app review with no explanation.
 */
export const termsResponseSchema = documentResponseSchema
export type TermsResponse = DocumentResponse
