import type { DocumentResponse } from '@sage-burner/shared'

import { useLoad } from '../load.ts'
import { renderMarkdown } from '../markdown.ts'
import { ErrorText } from './ErrorText.tsx'

export const MarkdownPage = ({
  title,
  load,
  empty,
  fallback,
}: {
  title: string
  load: (signal?: AbortSignal) => Promise<DocumentResponse>
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
