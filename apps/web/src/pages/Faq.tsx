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
  /** Whether the bar picked it, as opposed to the fallback below (#321). */
  picked: boolean
  entries: readonly FaqEntry[]
  sources: readonly CopySource[]
}

/** Null rather than a fourth status: "there is no burn at all" is data, not an outcome. */
type Questions = Shown | null

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
 * to bottom, and the question people have first belongs first — so it is a
 * `ReorderableList`.
 *
 * **It does not need a burn you are in** (#321). Every burn-scoped page takes its burn
 * from the bar, which lists the ones you have said you are coming to — so an approved
 * member who has not joined one landed on `NoBurn` and could read nothing. This is the
 * page that answers "what does taking part actually ask of me?", which is read *before*
 * deciding, so the next burn answers when the bar has nothing. The guard is unchanged:
 * members, not the public, and writes are any approved member's as they already were.
 */
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
      // `getActiveEvent` is the next burn that has not ended, and is public — so this
      // asks nothing the reader is not already allowed. Null there is the one state
      // with nothing to show: no burn planned at all.
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
      // Waited for, or a member's own burn would arrive after the fallback had already
      // loaded somebody else's — the burns are fetched once for the session.
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

/**
 * One question, closed until somebody opens it.
 *
 * Removing takes two clicks, like a lead role and unlike a lane (#323). What one row
 * holds is a paragraph somebody else wrote and nobody has a copy of, so a misplaced
 * tap costs an answer rather than a word.
 */
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
        // Written by any approved member and read by all of them. `renderMarkdown`
        // escapes raw HTML rather than filtering it, which is what makes a member
        // author safe to have.
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

/**
 * Which burn this is, and whether there is anything on it yet.
 *
 * Says the name whenever the bar did not choose it, because two burns' answers read
 * alike (#321). It says only that, and nothing about the reader: the bar is empty
 * either because they are signed up to no burn or because the burns fetch failed, and
 * #193's rule is that the second must not be described as a fact about them.
 *
 * With no burn at all, the admin gets the one pointer that leads somewhere — they are
 * the only person who can make one.
 */
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
