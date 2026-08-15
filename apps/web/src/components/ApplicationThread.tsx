import type { ApplicationMessage } from '@sage-burner/shared'

import { MAX_COMMENT } from '@sage-burner/shared'
import { useEffect, useRef, useState } from 'preact/hooks'

import { localDay } from '../datetime.ts'
import { renderMarkdown } from '../markdown.ts'
import { ErrorText } from './ErrorText.tsx'
import { MarkdownField } from './MarkdownField.tsx'
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
  const sent = useRef(messages.length)

  useEffect(() => {
    if (messages.length > sent.current) setSaying('')
    sent.current = messages.length
  }, [messages.length])

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

      <div class="thread-say">
        <MarkdownField
          label={`what you say to ${subject}`}
          labelHidden
          accessibleName={`Say something to ${subject}`}
          placeholder="Say something…"
          value={saying}
          maxLength={MAX_COMMENT}
          rows={2}
          onInput={setSaying}
        />
        <PendingButton
          busy={busy}
          label="Send"
          busyLabel="Sending…"
          type="button"
          disabled={saying.trim() === ''}
          onClick={() => onSay(saying.trim())}
        />
      </div>
    </section>
  )
}
