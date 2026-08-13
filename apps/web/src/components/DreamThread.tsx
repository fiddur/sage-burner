import type { Thread, ThreadEntry, ThreadEntryKind } from '@sage-burner/shared'

import { MAX_COMMENT, profilePage } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { UploadImage } from '../image-upload.ts'
import type { Mentionable } from '../mentioning.ts'

import { localDay } from '../datetime.ts'
import { stillUploading, useImageUpload } from '../image-upload.ts'
import { renderMarkdown } from '../markdown.ts'
import { useMentioning } from '../mentioning.ts'
import { rowsFor } from '../textarea.ts'
import { AddPicture } from './AddPicture.tsx'
import { IconButton } from './IconButton.tsx'
import { MentionMenu } from './MentionMenu.tsx'
import { NAMELESS } from './PersonBadge.tsx'
import { SyntaxToolbar, useSyntax } from './SyntaxToolbar.tsx'

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
  onSay: (body: string) => void
  onRewrite: (id: string, body: string) => void
  onRemove: (id: string) => void
  onShowAll?: () => void
}) => {
  const [saying, setSaying] = useState('')
  const [editing, setEditing] = useState<{ id: string; body: string } | undefined>(undefined)

  const sayingPictures = useImageUpload({
    value: saying,
    maxLength: MAX_COMMENT,
    onInput: setSaying,
    upload,
  })

  const naming = useMentioning({ value: saying, people, maxLength: MAX_COMMENT, onInput: setSaying })

  const sayingSyntax = useSyntax({ value: saying, maxLength: MAX_COMMENT, onInput: setSaying })

  const renaming = useMentioning({
    value: editing?.body ?? '',
    people,
    maxLength: MAX_COMMENT,
    onInput: (body) => setEditing((current) => (current === undefined ? current : { ...current, body })),
  })

  const editingPictures = useImageUpload({
    value: editing?.body ?? '',
    maxLength: MAX_COMMENT,
    onInput: (body) => setEditing((current) => (current === undefined ? current : { ...current, body })),
    upload,
  })

  const editingSyntax = useSyntax({
    value: editing?.body ?? '',
    maxLength: MAX_COMMENT,
    onInput: (body) => setEditing((current) => (current === undefined ? current : { ...current, body })),
  })

  if (thread === undefined) return null

  const say = () => {
    if (saying.trim() === '') return

    onSay(saying.trim())
    setSaying('')
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
                <>
                  <SyntaxToolbar syntax={editingSyntax} subject="what you said" />
                  <div class="thread-editing">
                    <textarea
                      class="thread-box"
                      aria-label="Rewrite what you said"
                      ref={editingSyntax.ref}
                      maxLength={MAX_COMMENT}
                      rows={rowsFor(editing.body, 2)}
                      value={editing.body}
                      onInput={(event) => setEditing({ id: entry.id, body: event.currentTarget.value })}
                      {...editingSyntax.handlers}
                      {...editingPictures.handlers}
                      {...renaming.noticing}
                    />
                    <MentionMenu
                      candidates={renaming.candidates}
                      subject="what you said"
                      onChoose={renaming.choose}
                    />
                    <AddPicture pictures={editingPictures} label="what you said" />
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
                </>
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
                        icon="✏️"
                        label="Rewrite what you said"
                        disabled={busy}
                        onClick={() => setEditing({ id: entry.id, body: entry.body })}
                      />
                    )}
                    {(entry.author?.account_id === viewerId || admin) && (
                      <IconButton
                        icon="🗑️"
                        label="Take this comment back"
                        disabled={busy}
                        onClick={() => onRemove(entry.id)}
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

      <SyntaxToolbar syntax={sayingSyntax} subject={`what you say about ${thread.title}`} />

      <p class="thread-say">
        <textarea
          class="thread-box"
          aria-label={`Say something about ${thread.title}`}
          placeholder="Say something…"
          ref={sayingSyntax.ref}
          maxLength={MAX_COMMENT}
          rows={rowsFor(saying, 2)}
          value={saying}
          onInput={(event) => setSaying(event.currentTarget.value)}
          {...sayingSyntax.handlers}
          {...sayingPictures.handlers}
          {...naming.noticing}
        />
        <button type="button" disabled={busy || stillUploading(saying) || saying.trim() === ''} onClick={say}>
          Say it
        </button>
      </p>

      <MentionMenu
        candidates={naming.candidates}
        subject={`what you say about ${thread.title}`}
        onChoose={naming.choose}
      />

      <AddPicture pictures={sayingPictures} label={`what you say about ${thread.title}`} />
    </div>
  )
}
