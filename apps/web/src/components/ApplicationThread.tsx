import type { ApplicationMessage } from '@sage-burner/shared'

import { MAX_COMMENT } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import { localDay } from '../datetime.ts'
import { renderMarkdown } from '../markdown.ts'
import { rowsFor } from '../textarea.ts'
import { ErrorText } from './ErrorText.tsx'
import { PendingButton } from './PendingButton.tsx'

export const ApplicationThread = ({
  messages,
  busy,
  error,
  subject,
  onSay,
}: {
  messages: readonly ApplicationMessage[]
  busy: boolean
  error?: string
  subject: string
  onSay: (body: string) => void
}) => {
  const [saying, setSaying] = useState('')

  return (
    <section class="application-thread">
      <h2>Between you and the organisers</h2>
      <p class="form-note">Only they and you can read this.</p>

      {messages.length > 0 && (
        <ol class="thread-entries">
          {messages.map((message) => (
            <li key={message.id} class="thread-said">
              <p class="thread-who">
                <strong>{message.mine ? 'You' : (message.author_name ?? 'An organiser')}</strong>{' '}
                <span class="thread-when">{localDay(message.created_at)}</span>
              </p>
              <div
                class="markdown-preview"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(message.body) }}
              />
            </li>
          ))}
        </ol>
      )}

      <ErrorText message={error} />

      <p class="thread-say">
        <textarea
          class="thread-box"
          aria-label={`Say something to ${subject}`}
          placeholder="Say something…"
          maxLength={MAX_COMMENT}
          rows={rowsFor(saying, 2)}
          value={saying}
          onInput={(typed) => setSaying(typed.currentTarget.value)}
        />
        <PendingButton
          busy={busy}
          label="Send"
          busyLabel="Sending…"
          type="button"
          disabled={saying.trim() === ''}
          onClick={() => {
            onSay(saying.trim())
            setSaying('')
          }}
        />
      </p>
    </section>
  )
}
