import type { DocumentResponse } from '@sage-burner/shared'

import { useLoad } from '../load.ts'
import { renderMarkdown } from '../markdown.ts'
import { ErrorText } from './ErrorText.tsx'

/**
 * One of the markdown files the backend serves, as a page (#419).
 *
 * The changelog (#325) and the privacy policy (#402) were this component written twice,
 * differing in a heading and two sentences; the terms would have made it three.
 */
export const MarkdownPage = ({
  title,
  load,
  empty,
  fallback,
}: {
  /**
   * The page's own heading, shown in every state — which is why none of the files carries a
   * title of its own. `renderMarkdown` shifts a `#` down a level so authored content cannot
   * compete with a page heading, and a page whose only heading came from the file would have
   * started at `<h2>`.
   */
  title: string
  load: (signal?: AbortSignal) => Promise<DocumentResponse>
  /** What an image built without the file says. The page has to answer whoever opened it. */
  empty: string
  fallback: string
}) => {
  const { loaded } = useLoad((signal) => load(signal), { fallback })

  return (
    <section class="page prose">
      <h1>{title}</h1>

      {loaded.status === 'loading' && <p class="form-note">One moment…</p>}

      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      {loaded.status === 'ready' &&
        (loaded.data.markdown.trim() === '' ? (
          <p class="form-note">{empty}</p>
        ) : (
          <div
            class="markdown-preview"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(loaded.data.markdown) }}
          />
        ))}
    </section>
  )
}
