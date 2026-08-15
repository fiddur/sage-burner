import type { Thread, ThreadEntry, ThreadEntryKind } from '@sage-burner/shared'

import { MAX_COMMENT, profilePage } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { UploadImage } from '../image-upload.ts'
import type { Mentionable } from '../mentioning.ts'

import { localDay } from '../datetime.ts'
import { stillUploading } from '../image-upload.ts'
import { renderMarkdown } from '../markdown.ts'
import { Destroy } from './Destroy.tsx'
import { IconButton } from './IconButton.tsx'
import { MarkdownField } from './MarkdownField.tsx'
import { NAMELESS } from './PersonBadge.tsx'

const marks = {
  comment: '',
  offered: '🌱',
  joined: '🎪',
  introduced: '✍️',
  posted: '📣',
  added: '➕',
  restored: '↩️',
  facilitator: '👉',
  helper: '🙋',
  renamed: '✏️',
  scheduled: '📅',
  edited: '✏️',
  withdrawn: '🗑️',
  raised: '🗣️',
  decided: '⚖️',
} as const satisfies Record<ThreadEntryKind, string>

const nameOf = (entry: ThreadEntry) => entry.author?.name ?? (entry.author === null ? 'Somebody' : NAMELESS)

const Who = ({ entry }: { entry: ThreadEntry }) =>
  entry.author === null ? (
    <strong>{nameOf(entry)}</strong>
  ) : (
    <a href={profilePage(entry.author.account_id)}>
      <strong>{nameOf(entry)}</strong>
    </a>
  )

export const DreamThread = ({
  thread,
  viewerId,
  admin,
  busy,
  more,
  upload,
  people,
  onSay,
  onRewrite,
  onRemove,
  onShowAll,
}: {
  thread: Thread | undefined
  viewerId: string | undefined
  admin: boolean
  busy: boolean
  more: boolean
  upload: UploadImage
  people?: readonly Mentionable[]
  onSay: (body: string, done: () => void) => void
  onRewrite: (id: string, body: string) => void
  onRemove: (id: string) => void
  onShowAll?: () => void
}) => {
  const [saying, setSaying] = useState('')
  const [editing, setEditing] = useState<{ id: string; body: string } | undefined>(undefined)

  if (thread === undefined) return null

  // Emptied by the caller's `done` rather than on the way out: a reply to a thread somebody has
  // just deleted answers 404, and what was typed used to go with it (#614).
  const say = () => {
    if (saying.trim() === '') return

    onSay(saying.trim(), () => setSaying(''))
  }

  return (
    <div class="thread">
      {more && onShowAll !== undefined && (
        <p class="thread-more">
          <button type="button" class="link-button" disabled={busy} onClick={onShowAll}>
            Show the whole thread ({thread.entry_count})
          </button>
        </p>
      )}

      <ol class="thread-entries">
        {thread.entries.map((entry) =>
          entry.kind === 'comment' ? (
            <li key={entry.id} class="thread-said">
              <p class="thread-who">
                <Who entry={entry} />{' '}
                <span class="thread-when">
                  {localDay(entry.created_at)}
                  {entry.edited_at !== null && ' · edited'}
                </span>
              </p>

              {editing?.id === entry.id ? (
                <div class="thread-editing">
                  <MarkdownField
                    label="what you said"
                    labelHidden
                    accessibleName="Rewrite what you said"
                    value={editing.body}
                    maxLength={MAX_COMMENT}
                    rows={2}
                    upload={upload}
                    people={people}
                    onInput={(body) => setEditing({ id: entry.id, body })}
                  />
                  <button
                    type="button"
                    disabled={busy || stillUploading(editing.body) || editing.body.trim() === ''}
                    onClick={() => {
                      onRewrite(entry.id, editing.body.trim())
                      setEditing(undefined)
                    }}
                  >
                    Save
                  </button>
                  <button type="button" class="link-button" onClick={() => setEditing(undefined)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  {/* `renderMarkdown` escapes raw HTML rather than filtering it, which is what makes this safe. */}
                  <div
                    class="markdown-preview"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.body) }}
                  />
                  <p class="thread-mine">
                    {entry.author?.account_id === viewerId && (
                      <IconButton
                        icon="edit"
                        label="Rewrite what you said"
                        disabled={busy}
                        onClick={() => setEditing({ id: entry.id, body: entry.body })}
                      />
                    )}
                    {(entry.author?.account_id === viewerId || admin) && (
                      <Destroy
                        what="this comment"
                        verb="Take back"
                        busy={busy}
                        onDestroy={() => onRemove(entry.id)}
                      />
                    )}
                  </p>
                </>
              )}
            </li>
          ) : (
            <li key={entry.id} class="thread-did">
              <span aria-hidden="true">{marks[entry.kind]}</span> {nameOf(entry)} {entry.body}
              <span class="thread-when"> · {localDay(entry.created_at)}</span>
            </li>
          ),
        )}
      </ol>

      <div class="thread-say">
        <MarkdownField
          label={`what you say about ${thread.title}`}
          labelHidden
          accessibleName={`Say something about ${thread.title}`}
          placeholder="Say something…"
          value={saying}
          maxLength={MAX_COMMENT}
          rows={2}
          upload={upload}
          people={people}
          onInput={setSaying}
        />
        <button type="button" disabled={busy || stillUploading(saying) || saying.trim() === ''} onClick={say}>
          Say it
        </button>
      </div>
    </div>
  )
}
