import type { ApiClient } from '../api/client.ts'

import { MarkdownPage } from '../components/MarkdownPage.tsx'

export type ChangelogApi = Pick<ApiClient, 'getChangelog'>

/**
 * What's new — where "a new version is out" leads (#325).
 *
 * The notification used to name no page, because nothing in the app could say what a release
 * contained. A hand-written `CHANGELOG.md` can, so the bell row and the redeploy bar both
 * point here.
 *
 * Public, because the bar that links here is on every page a signed-out visitor can see.
 * Fetched rather than bundled — `changelogResponseSchema` says why both.
 */
export const Changelog = ({ api }: { api: ChangelogApi }) => (
  <MarkdownPage
    title="What's new"
    load={(signal) => api.getChangelog(signal)}
    empty="Nothing is written down for this version."
    fallback="Could not load what is new. Please try again shortly."
  />
)
