import type { ApiClient } from '../api/client.ts'

import { MarkdownPage } from '../components/MarkdownPage.tsx'

export type ChangelogApi = Pick<ApiClient, 'getChangelog'>

export const Changelog = ({ api }: { api: ChangelogApi }) => (
  <MarkdownPage
    title="What's new"
    load={(signal) => api.getChangelog(signal)}
    empty="Nothing is written down for this version."
    fallback="Could not load what is new. Please try again shortly."
  />
)
