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
      {/* The page's own, in every state, which is why the file has no title of its own:
          `renderMarkdown` shifts a `#` down a level so member-authored content cannot
          compete with a page heading, and a page whose only heading came from the file
          would have started at `<h2>`. The file's date sections are `#`, landing here. */}
      <h1>What's new</h1>

      {loaded.status === 'loading' && <p class="form-note">One moment…</p>}

      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      {loaded.status === 'ready' &&
        (loaded.data.markdown.trim() === '' ? (
          // An installation built without the file, rather than an error: the
          // notification that sends people here must land on something.
          <p class="form-note">Nothing is written down for this version.</p>
        ) : (
          <div
            class="markdown-preview"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(loaded.data.markdown) }}
          />
        ))}
    </section>
  )
}
