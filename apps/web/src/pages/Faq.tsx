import type { CopySourcesResponse, FaqEntry } from '@sage-burner/shared'

import { MAX_QUESTION_LABEL, MAX_WELCOME_LENGTH } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { Loaded } from '../load.ts'

import { useSelectedBurn } from '../burn.tsx'
import { CopyFrom } from '../components/CopyFrom.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { MarkdownField } from '../components/MarkdownField.tsx'
import { NoBurn } from '../components/NoBurn.tsx'
import { Refreshing } from '../components/Refreshing.tsx'
import { useAction, useLoad } from '../load.ts'
import { renderMarkdown } from '../markdown.ts'
import { moveTo, swap } from '../reorder.ts'
import { isApproved, useViewer } from '../viewer.tsx'

export type FaqApi = Pick<
  ApiClient,
  'getFaq' | 'addFaqEntry' | 'updateFaqEntry' | 'deleteFaqEntry' | 'reorderFaq' | 'getFaqSources' | 'copyFaq'
>

type Source = CopySourcesResponse['sources'][number]

/** Null rather than a fourth status: "no burn is selected" is data, not a load outcome. */
type Questions = { eventId: string; entries: readonly FaqEntry[]; sources: readonly Source[] } | null

const UNANSWERED = 'Nobody has answered this yet.'

/**
 * The Q&A the spreadsheet had a tab for (#28).
 *
 * **Questions are always visible, answers are not.** The list is read by somebody
 * looking for one thing, so it is a column of headings they scan and open — a page
 * of expanded answers would be the wall of text the tab already was. `<details>`
 * rather than state of our own: it keeps the browser's find-in-page working, which
 * is how half of finding an answer actually happens.
 *
 * **Anyone may ask, and anyone may answer.** The person with the question is rarely
 * the person with the answer, so an entry can exist with no answer at all and says
 * where one is still wanted. The order is somebody's arrangement — a FAQ is read top
 * to bottom, and the question people have first belongs first — so it is draggable,
 * with the arrow keys doing the same thing for anybody not using a mouse.
 */
export const Faq = ({ api }: { api: FaqApi }) => {
  const viewer = useViewer()
  const approved = isApproved(viewer)
  const [asking, setAsking] = useState('')
  const [editing, setEditing] = useState<string | undefined>(undefined)
  const [dragging, setDragging] = useState<number | undefined>(undefined)

  const burn = useSelectedBurn()
  const { loaded, refreshing, reload } = useLoad<Questions>(
    async (signal) => {
      if (burn === undefined) return null

      const eventId = burn.event.id
      const [faq, sources] = await Promise.all([
        api.getFaq(eventId, signal),
        api.getFaqSources(eventId, signal),
      ])

      return { eventId, entries: faq.entries, sources: sources.sources }
    },
    { enabled: approved, key: burn?.event.id ?? '', fallback: 'Could not load the questions.' },
  )

  const { busy, error, setError, run } = useAction(reload)

  const ready = loaded.status === 'ready' ? (loaded.data ?? undefined) : undefined
  const entries = ready?.entries ?? []
  const ids = entries.map((row) => row.id)

  const reorderTo = (wanted: string[] | undefined) => {
    if (wanted === undefined || ready === undefined) return
    run(() => api.reorderFaq(ready.eventId, wanted), 'Could not reorder the questions.')
  }

  const askIt = () => {
    if (ready === undefined) return
    if (asking.trim() === '') {
      setError('Type the question first.')
      return
    }

    run(async () => {
      await api.addFaqEntry(ready.eventId, { question: asking.trim() })
      setAsking('')
    }, 'Could not add that question.')
  }

  return (
    <GuardedPage title="FAQ" require="approved">
      <h1>
        FAQ <Refreshing on={refreshing} />
      </h1>

      <p class="form-note">
        How to get there, what to bring, what taking part actually asks of you. Anyone can ask a question and
        anyone can answer one — including a question somebody else asked.
      </p>

      {error !== undefined && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}

      <Notice loaded={loaded} />

      {ready !== undefined && entries.length === 0 && ready.sources.length > 0 && (
        <CopyFrom
          sources={ready.sources}
          what="questions"
          note="The questions and the answers, as they were arranged."
          busy={busy}
          onCopy={(fromEventId) =>
            run(() => api.copyFaq(ready.eventId, fromEventId), 'Could not copy those questions.')
          }
        />
      )}

      <ol class="faq-list">
        {entries.map((row, index) => (
          <li
            key={row.id}
            class={dragging === index ? 'faq-row faq-dragging' : 'faq-row'}
            onDragOver={(dragEvent) => {
              // Without this the drop never fires — the default is "not a drop target".
              dragEvent.preventDefault()
            }}
            onDrop={(dropEvent) => {
              dropEvent.preventDefault()
              if (dragging !== undefined) reorderTo(moveTo(ids, dragging, index))
              setDragging(undefined)
            }}
          >
            <button
              type="button"
              class="drag-handle"
              draggable
              disabled={busy}
              aria-label={`Move ${row.question}`}
              onDragStart={(dragEvent) => {
                // Firefox will not start a drag whose data store is empty.
                dragEvent.dataTransfer?.setData('text/plain', row.id)
                setDragging(index)
              }}
              onDragEnd={() => setDragging(undefined)}
              onKeyDown={(keyEvent) => {
                // The handle is the keyboard route too: a reorder nobody can do
                // without a mouse is a reorder half the people here cannot do.
                const by = keyEvent.key === 'ArrowUp' ? -1 : keyEvent.key === 'ArrowDown' ? 1 : undefined
                if (by === undefined) return
                keyEvent.preventDefault()
                reorderTo(swap(ids, index, by))
              }}
            >
              ⠿
            </button>

            {editing === row.id ? (
              <FaqFields
                entry={row}
                busy={busy}
                onCancel={() => setEditing(undefined)}
                onSave={(changes) => {
                  run(async () => {
                    await api.updateFaqEntry(row.id, changes)
                    setEditing(undefined)
                  }, 'Could not save that.')
                }}
              />
            ) : (
              <details class="faq-entry">
                <summary>{row.question}</summary>

                {row.answer.trim() === '' ? (
                  <p class="form-note">{UNANSWERED}</p>
                ) : (
                  // Written by any approved member and read by all of them.
                  // `renderMarkdown` escapes raw HTML rather than filtering it, which
                  // is what makes a member author safe to have.
                  <div
                    class="markdown-preview"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(row.answer) }}
                  />
                )}

                <p class="row">
                  <button
                    type="button"
                    class="link-button"
                    disabled={busy}
                    onClick={() => setEditing(row.id)}
                  >
                    {row.answer.trim() === '' ? 'Answer it' : 'Edit'}
                  </button>
                  <button
                    type="button"
                    class="link-button"
                    disabled={busy}
                    aria-label={`Remove ${row.question}`}
                    onClick={() => run(() => api.deleteFaqEntry(row.id), 'Could not remove that question.')}
                  >
                    🗑️
                  </button>
                </p>
              </details>
            )}
          </li>
        ))}
      </ol>

      {/* Only once the burn is known: a question belongs to one, so a form rendered
          before then would take one and have nowhere to put it. */}
      {ready !== undefined && (
        <form
          class="form"
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault()
            askIt()
          }}
        >
          <h2>Ask a question</h2>

          <label class="field">
            <span>What do you want to know?</span>
            <input
              type="text"
              name="question"
              maxLength={MAX_QUESTION_LABEL}
              aria-required
              value={asking}
              onInput={(inputEvent) => setAsking(inputEvent.currentTarget.value)}
            />
          </label>

          <p class="form-note">
            The answer can come later, and from somebody else — an unanswered question on the page is how
            whoever knows finds out it was asked.
          </p>

          <button type="submit" disabled={busy}>
            Add it
          </button>
        </form>
      )}
    </GuardedPage>
  )
}

const Notice = ({ loaded }: { loaded: Loaded<Questions> }) => {
  if (loaded.status === 'loading') return <p class="form-note">Loading…</p>
  if (loaded.status === 'failed') {
    return (
      <p class="form-error" role="alert">
        {loaded.message}
      </p>
    )
  }
  if (loaded.data === null) return <NoBurn absent="there are no questions to answer" />
  if (loaded.data.entries.length === 0) return <p class="form-note">Nobody has asked anything yet.</p>

  return null
}

const FaqFields = ({
  entry,
  busy,
  onSave,
  onCancel,
}: {
  entry: FaqEntry
  busy: boolean
  onSave: (changes: { question?: string; answer?: string }) => void
  onCancel: () => void
}) => {
  // Seeded once. The page re-reads under a refused save (#274), and taking the fresh
  // text into the box would throw away what is being written.
  const [question, setQuestion] = useState(entry.question)
  const [answer, setAnswer] = useState(entry.answer)

  return (
    <div class="faq-edit">
      <label class="field">
        <span>Question</span>
        <input
          type="text"
          maxLength={MAX_QUESTION_LABEL}
          aria-label={`Question for ${entry.question}`}
          value={question}
          onInput={(inputEvent) => setQuestion(inputEvent.currentTarget.value)}
        />
      </label>

      <MarkdownField
        label={`Answer to ${entry.question}`}
        value={answer}
        maxLength={MAX_WELCOME_LENGTH}
        onInput={setAnswer}
      />

      <p class="row">
        <button type="button" disabled={busy} onClick={() => onSave({ question: question.trim(), answer })}>
          Save
        </button>
        <button type="button" class="link-button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </p>
    </div>
  )
}
