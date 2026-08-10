import type { FaqEntry } from '@sage-burner/shared'

import { MAX_FAQ_ANSWER, MAX_FAQ_QUESTION } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { CopySource } from '../components/CopyFrom.tsx'
import type { UploadImage } from '../image-upload.ts'
import type { Loaded } from '../load.ts'

import { useBurns, useSelectedBurn } from '../burn.tsx'
import { CopyFrom } from '../components/CopyFrom.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { IconButton } from '../components/IconButton.tsx'
import { MarkdownField } from '../components/MarkdownField.tsx'
import { Refreshing } from '../components/Refreshing.tsx'
import { ReorderableList } from '../components/ReorderableList.tsx'
import { stillUploading } from '../image-upload.ts'
import { useAction, useLoad } from '../load.ts'
import { renderMarkdown } from '../markdown.ts'
import { isAdmin, isApproved, useViewer } from '../viewer.tsx'

export type FaqApi = Pick<
  ApiClient,
  | 'getFaq'
  | 'addFaqEntry'
  | 'updateFaqEntry'
  | 'deleteFaqEntry'
  | 'reorderFaq'
  | 'getFaqSources'
  | 'copyFaq'
  | 'getActiveEvent'
  | 'uploadImage'
>

interface Shown {
  eventId: string
  name: string
  picked: boolean
  entries: readonly FaqEntry[]
  sources: readonly CopySource[]
}

type Questions = Shown | null

const UNANSWERED = 'Nobody has answered this yet.'

export const Faq = ({ api }: { api: FaqApi }) => {
  const viewer = useViewer()
  const approved = isApproved(viewer)
  const [asking, setAsking] = useState('')
  const [editing, setEditing] = useState<string | undefined>(undefined)

  const burns = useBurns()
  const burn = useSelectedBurn()
  const { loaded, refreshing, reload } = useLoad<Questions>(
    async (signal) => {
      const picked = burn?.event
      const shown = picked ?? (await api.getActiveEvent(signal)).event
      if (shown === null) return null

      const [faq, sources] = await Promise.all([
        api.getFaq(shown.id, signal),
        api.getFaqSources(shown.id, signal),
      ])

      return {
        eventId: shown.id,
        name: shown.name,
        picked: picked !== undefined,
        entries: faq.entries,
        sources: sources.sources,
      }
    },
    {
      enabled: approved && burns.status !== 'loading',
      key: burn?.event.id ?? burns.status,
      fallback: 'Could not load the questions.',
    },
  )

  const { busy, error, setError, run } = useAction(reload)

  const ready = loaded.status === 'ready' ? (loaded.data ?? undefined) : undefined
  const entries = ready?.entries ?? []

  const reorderTo = (wanted: string[]) => {
    if (ready === undefined) return
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

      <ErrorText message={error} />

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

      <ReorderableList
        rows={entries}
        busy={busy}
        rowClass="faq-row"
        labelFor={(row) => row.question}
        onReorder={reorderTo}
      >
        {(row) =>
          editing === row.id ? (
            <FaqFields
              entry={row}
              busy={busy}
              upload={api.uploadImage}
              onCancel={() => setEditing(undefined)}
              onSave={(changes) => {
                run(async () => {
                  await api.updateFaqEntry(row.id, changes)
                  setEditing(undefined)
                }, 'Could not save that.')
              }}
            />
          ) : (
            <FaqRow
              entry={row}
              busy={busy}
              onEdit={() => setEditing(row.id)}
              onRemove={() => run(() => api.deleteFaqEntry(row.id), 'Could not remove that question.')}
            />
          )
        }
      </ReorderableList>

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
              maxLength={MAX_FAQ_QUESTION}
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

const FaqRow = ({
  entry,
  busy,
  onEdit,
  onRemove,
}: {
  entry: FaqEntry
  busy: boolean
  onEdit: () => void
  onRemove: () => void
}) => {
  const [confirming, setConfirming] = useState(false)
  const answered = entry.answer.trim() !== ''

  return (
    <details class="faq-entry">
      <summary>{entry.question}</summary>

      {answered ? (
        <div class="markdown-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.answer) }} />
      ) : (
        <p class="form-note">{UNANSWERED}</p>
      )}

      <p class="row">
        <button type="button" class="link-button" disabled={busy} onClick={onEdit}>
          {answered ? 'Edit' : 'Answer it'}
        </button>

        {confirming ? (
          <>
            <span class="form-note">Remove this question and its answer?</span>
            <button
              type="button"
              disabled={busy}
              aria-label={`Really remove ${entry.question}`}
              onClick={onRemove}
            >
              Remove it
            </button>
            <button type="button" class="link-button" disabled={busy} onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </>
        ) : (
          <IconButton
            icon="🗑️"
            label={`Remove ${entry.question}`}
            disabled={busy}
            onClick={() => setConfirming(true)}
          />
        )}
      </p>
    </details>
  )
}

const Notice = ({ loaded }: { loaded: Loaded<Questions> }) => {
  const admin = isAdmin(useViewer())

  if (loaded.status === 'loading') return <p class="form-note">Loading…</p>
  if (loaded.status === 'failed') return <ErrorText message={loaded.message} />
  if (loaded.data === null) {
    return (
      <p class="form-note">
        There is no burn planned yet, so there is nothing to ask about.
        {admin && (
          <>
            {' '}
            Make one under <a href="/admin/events">Events</a>.
          </>
        )}
      </p>
    )
  }

  return (
    <>
      {!loaded.data.picked && <p class="form-note">Showing {loaded.data.name}, the next burn.</p>}
      {loaded.data.entries.length === 0 && <p class="form-note">Nobody has asked anything yet.</p>}
    </>
  )
}

const FaqFields = ({
  entry,
  busy,
  upload,
  onSave,
  onCancel,
}: {
  entry: FaqEntry
  busy: boolean
  upload: UploadImage
  onSave: (changes: { question?: string; answer?: string }) => void
  onCancel: () => void
}) => {
  const [question, setQuestion] = useState(entry.question)
  const [answer, setAnswer] = useState(entry.answer)

  return (
    <div class="faq-edit">
      <label class="field">
        <span>Question</span>
        <input
          type="text"
          maxLength={MAX_FAQ_QUESTION}
          aria-label={`Question for ${entry.question}`}
          value={question}
          onInput={(inputEvent) => setQuestion(inputEvent.currentTarget.value)}
        />
      </label>

      <MarkdownField
        label={`Answer to ${entry.question}`}
        value={answer}
        maxLength={MAX_FAQ_ANSWER}
        upload={upload}
        onInput={setAnswer}
      />

      <p class="row">
        <button
          type="button"
          disabled={busy || stillUploading(answer)}
          onClick={() => onSave({ question: question.trim(), answer })}
        >
          Save
        </button>
        <button type="button" class="link-button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </p>
    </div>
  )
}
