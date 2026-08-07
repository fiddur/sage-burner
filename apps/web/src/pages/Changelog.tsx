import type { ApiClient } from '../api/client.ts'

import { ErrorText } from '../components/ErrorText.tsx'
import { useLoad } from '../load.ts'
import { renderMarkdown } from '../markdown.ts'

export type ChangelogApi = Pick<ApiClient, 'getChangelog'>

/**
 * What's new — where "a new version is out" leads (#325).
 *
 * The notification used to name no page, because nothing in the app could say what a
 * release contained. A hand-written `CHANGELOG.md` can, so the bell row and the
 * redeploy bar both point here.
 *
 * Public, because the bar that links here is on every page a signed-out visitor can
 * see. Fetched rather than bundled — `changelogResponseSchema` says why both.
 */
export const Changelog = ({ api }: { api: ChangelogApi }) => {
  const { loaded } = useLoad((signal) => api.getChangelog(signal), {
    fallback: 'Could not load what is new. Please try again shortly.',
  })

  return (
    <section class="page prose">
      {loaded.status === 'loading' && <p class="form-note">One moment…</p>}

      {loaded.status === 'failed' && (
        <>
          <h1>What's new</h1>
          <ErrorText message={loaded.message} />
        </>
      )}

      {loaded.status === 'ready' &&
        (loaded.data.markdown.trim() === '' ? (
          <>
            <h1>What's new</h1>
            {/* An installation built without the file, rather than an error: the
                notification that sends people here must land on something. */}
            <p class="form-note">Nothing is written down for this version.</p>
          </>
        ) : (
          // The heading comes from the file, which is why this page has none of its
          // own. Written by whoever deploys the app, and rendered through the same
          // escaping every other markdown field uses.
          <div
            class="markdown-preview"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(loaded.data.markdown) }}
          />
        ))}
    </section>
  )
}
