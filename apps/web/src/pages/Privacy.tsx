import type { ApiClient } from '../api/client.ts'

import { ErrorText } from '../components/ErrorText.tsx'
import { useLoad } from '../load.ts'
import { renderMarkdown } from '../markdown.ts'

export type PrivacyApi = Pick<ApiClient, 'getPrivacy'>

/**
 * What this app holds about somebody, and who can see it (#402).
 *
 * Public, and that is the requirement rather than a nicety: Facebook's app review will not
 * take an app without a policy at a URL, and a reviewer opens it as a stranger. So does
 * anybody deciding whether to apply, which is the better reason for it to exist.
 *
 * `Changelog`'s shape throughout — the page owns the `<h1>` so the file needs none, and
 * `renderMarkdown` shifts a `#` down a level under it.
 */
export const Privacy = ({ api }: { api: PrivacyApi }) => {
  const { loaded } = useLoad((signal) => api.getPrivacy(signal), {
    fallback: 'Could not load the privacy policy. Please try again shortly.',
  })

  return (
    <section class="page prose">
      <h1>Privacy</h1>

      {loaded.status === 'loading' && <p class="form-note">One moment…</p>}

      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      {loaded.status === 'ready' &&
        (loaded.data.markdown.trim() === '' ? (
          // An installation built without the file. Said plainly rather than shown as an
          // error, because the page has to answer *something* to whoever opened it.
          <p class="form-note">No privacy policy is written down for this version.</p>
        ) : (
          <div
            class="markdown-preview"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(loaded.data.markdown) }}
          />
        ))}
    </section>
  )
}
