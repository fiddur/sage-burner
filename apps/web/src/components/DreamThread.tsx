import type { Thread, ThreadEntry, ThreadEntryKind } from '@sage-burner/shared'

import { MAX_COMMENT, profilePage } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { UploadImage } from '../image-upload.ts'

import { localDay } from '../datetime.ts'
import { stillUploading, useImageUpload } from '../image-upload.ts'
import { renderMarkdown } from '../markdown.ts'
import { rowsFor } from '../textarea.ts'
import { AddPicture } from './AddPicture.tsx'
import { IconButton } from './IconButton.tsx'
import { NAMELESS } from './PersonBadge.tsx'

/**
 * What each kind of line wears, and how loudly it is drawn.
 *
 * The quiet ones are what the app did; a comment is what somebody said, and it is the
 * reason anybody opens the thread. One record rather than an icon map beside a weight
 * map: two objects keyed by the same union are two things to keep in step.
 */
const marks = {
  comment: '',
  offered: '🌱',
  facilitator: '👉',
  helper: '🙋',
  renamed: '✏️',
  scheduled: '📅',
  edited: '✏️',
  withdrawn: '🗑️',
} as const satisfies Record<ThreadEntryKind, string>

const nameOf = (entry: ThreadEntry) => entry.author?.name ?? (entry.author === null ? 'Somebody' : NAMELESS)

/**
 * Who said it, linked to their page (#389).
 *
 * The name a reader most wants to click: somebody has just said something and you do not
 * know who they are. A deleted author is "Somebody" and stays plain text — there is no page
 * left to point at, and a link to nowhere is worse than none.
 */
const Who = ({ entry }: { entry: ThreadEntry }) =>
  entry.author === null ? (
    <strong>{nameOf(entry)}</strong>
  ) : (
    <a href={profilePage(entry.author.account_id)}>
      <strong>{nameOf(entry)}</strong>
    </a>
  )

/**
 * The conversation about a dream (#375), wherever it is being read.
 *
 * The same component on the dream's own panel and on the feed's card, which is what
 * makes a withdrawn dream readable at all: the panel goes with the dream and the card
 * does not.
 *
 * It holds no thread of its own. Whoever renders it owns the fetching and the writes, so
 * a page that already reloads after every write does not gain a second copy of the truth
 * to keep in step.
 */
export const DreamThread = ({
  thread,
  viewerId,
  admin,
  busy,
  more,
  upload,
  onSay,
  onRewrite,
  onRemove,
  onShowAll,
}: {
  thread: Thread | undefined
  viewerId: string | undefined
  /** An admin may take a comment off. Nobody may rewrite somebody else's. */
  admin: boolean
  busy: boolean
  /** Whether there is more of it than is being shown — the feed's card carries a few. */
  more: boolean
  /**
   * How a photograph gets into what somebody says (#379). Required rather than optional:
   * a thread is the place pictures were wanted most, and a call site that forgot it would
   * silently be the one field that does not take them.
   */
  upload: UploadImage
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

  const editingPictures = useImageUpload({
    value: editing?.body ?? '',
    maxLength: MAX_COMMENT,
    onInput: (body) => setEditing((current) => (current === undefined ? current : { ...current, body })),
    upload,
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
                <div class="thread-editing">
                  <textarea
                    class="thread-box"
                    aria-label="Rewrite what you said"
                    maxLength={MAX_COMMENT}
                    rows={rowsFor(editing.body, 2)}
                    value={editing.body}
                    onInput={(event) => setEditing({ id: entry.id, body: event.currentTarget.value })}
                    {...editingPictures.handlers}
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
              ) : (
                <>
                  {/* Safe by construction: `renderMarkdown` escapes raw HTML rather than
                      filtering it, which is what makes untrusted authors — every member
                      here — inside what it defends against. */}
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

      <p class="thread-say">
        <textarea
          class="thread-box"
          aria-label={`Say something about ${thread.title}`}
          placeholder="Say something…"
          maxLength={MAX_COMMENT}
          rows={rowsFor(saying, 2)}
          value={saying}
          onInput={(event) => setSaying(event.currentTarget.value)}
          {...sayingPictures.handlers}
        />
        <button type="button" disabled={busy || stillUploading(saying) || saying.trim() === ''} onClick={say}>
          Say it
        </button>
      </p>

      <AddPicture pictures={sayingPictures} label={`what you say about ${thread.title}`} />
    </div>
  )
}
