import { z } from 'zod'

/**
 * `GET /api/version`.
 *
 * Deliberately just the build SHA. This is the container healthcheck, so it is
 * reachable by anything that can reach the container — not a place to expose
 * the environment, the database path, or dependency versions.
 */
export const versionResponseSchema = z.object({
  build_sha: z.string(),
})

export type VersionResponse = z.infer<typeof versionResponseSchema>

/**
 * `GET /api/changelog` — what changed, as the notification's page shows it (#325).
 *
 * Markdown, and the file the repository keeps rather than anything derived from git:
 * a changelog is written for the people using the app, and a list of commit subjects
 * is not that. Served by the backend rather than bundled into the web app, because a
 * tab that has just been told there is a new version is still running the old bundle
 * — and the entry it wants to read is the one that arrived with the build it does not
 * have yet.
 *
 * Public, like `/api/version`: it is release notes for an app whose homepage is
 * public, holds nobody's data, and ships in a public image either way.
 *
 * Empty where the image has no `CHANGELOG.md` — an installation built without it gets
 * a page saying so rather than a 404 the notification would land on.
 */
export const changelogResponseSchema = z.object({ markdown: z.string() })

export type ChangelogResponse = z.infer<typeof changelogResponseSchema>

/**
 * `GET /api/privacy` — what Facebook's app review asks for a URL to (#402).
 *
 * The changelog's shape and the changelog's reasoning: prose that ships with the image,
 * served rather than bundled, so a page can render it without a build step knowing about it.
 *
 * **Public, and that is the whole point.** A reviewer at Meta opens it as a stranger, and so
 * does anybody deciding whether to apply. A privacy policy behind a login is not one.
 *
 * Empty where the image has none — a page saying so, rather than a container that refuses to
 * start, since nothing here is load-bearing at boot.
 */
export const privacyResponseSchema = z.object({ markdown: z.string() })

export type PrivacyResponse = z.infer<typeof privacyResponseSchema>
