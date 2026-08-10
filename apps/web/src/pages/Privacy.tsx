import type { ApiClient } from '../api/client.ts'

import { MarkdownPage } from '../components/MarkdownPage.tsx'

export type PrivacyApi = Pick<ApiClient, 'getPrivacy'>

/**
 * What this app holds about somebody, and who can see it (#402). `privacyResponseSchema`
 * carries why the page is public — and why Meta's data deletion instructions point at it.
 */
export const Privacy = ({ api }: { api: PrivacyApi }) => (
  <MarkdownPage
    title="Privacy"
    load={(signal) => api.getPrivacy(signal)}
    empty="No privacy policy is written down for this version."
    fallback="Could not load the privacy policy. Please try again shortly."
  />
)
