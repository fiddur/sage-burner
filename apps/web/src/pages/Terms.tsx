import type { ApiClient } from '../api/client.ts'

import { MarkdownPage } from '../components/MarkdownPage.tsx'

export type TermsApi = Pick<ApiClient, 'getTerms'>

export const Terms = ({ api }: { api: TermsApi }) => (
  <MarkdownPage
    title="Terms"
    load={(signal) => api.getTerms(signal)}
    empty="No terms are written down for this version."
    fallback="Could not load the terms. Please try again shortly."
  />
)
