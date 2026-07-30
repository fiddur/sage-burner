import type { FormQuestion, FormQuestionType } from '@sage-burner/shared'

import { isFormQuestionType } from '@sage-burner/shared'
import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'

export type QuestionsApi = Pick<
  ApiClient,
  'addQuestion' | 'deleteQuestion' | 'getQuestions' | 'reorderQuestions' | 'updateQuestion'
>

type Loaded =
  | { status: 'loading' }
  | { status: 'ready'; questions: readonly FormQuestion[] }
  | { status: 'failed'; message: string }

const TYPES: { value: FormQuestionType; label: string }[] = [
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'agreement', label: 'Agreement (must be ticked)' },
]

const BLANK = { label: '', type: 'textarea' as FormQuestionType, help_text: '', required: true }

const messageFor = (failure: unknown, fallback: string) => (isApiError(failure) ? failure.message : fallback)

/**
 * A `<select>` yields `string`, and the shared vocabulary is the only authority
 * on which strings are types. Narrowed with the shared guard rather than cast:
 * the value comes from the DOM, so a cast would be a promise about markup this
 * file does not fully control, and `formQuestionTypes` is where a fifth type
 * will be added.
 */
const toQuestionType = (value: string, fallback: FormQuestionType) =>
  isFormQuestionType(value) ? value : fallback

/**
 * The application form's questions, for one event.
 *
 * These are rows rather than code precisely so an organiser can retune them
 * between burns without a deploy — so everything here writes through the API
 * and re-reads, rather than keeping a clever local model that could disagree
 * with what the public form will actually render.
 *
 * Reordering sends the **whole** list of ids. The API rejects a partial one:
 * moving one question renumbers several, and a half-applied reorder is an order
 * nobody chose.
 */
export const QuestionEditor = ({ api, eventId }: { api: QuestionsApi; eventId: string }) => {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [draft, setDraft] = useState(BLANK)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [editing, setEditing] = useState<string | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()

    api
      .getQuestions(eventId, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setLoaded({ status: 'ready', questions: response.questions })
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return
        setLoaded({ status: 'failed', message: messageFor(failure, 'Could not load the questions.') })
      })

    return () => {
      controller.abort()
    }
  }, [api, eventId])

  // Every mutation re-reads rather than patching local state. One extra request
  // per change, and in exchange what is on screen is what the public form will
  // render — including the `order` values the server assigned.
  const refresh = async () => {
    const response = await api.getQuestions(eventId)
    setLoaded({ status: 'ready', questions: response.questions })
  }

  const run = async (work: () => Promise<void>, fallback: string) => {
    if (busy) return
    setBusy(true)
    setError(undefined)
    try {
      await work()
      await refresh()
    } catch (failure) {
      setError(messageFor(failure, fallback))
      // Re-read on failure too, or the one error the API deliberately produces
      // becomes a dead end: another organiser adds a question, this list is now
      // stale, every ↑/↓ rebuilds the same short id list, and `sameSet` answers
      // 400 forever. Reloading the page was the only way out, and the message
      // did not say so. One request on an error path buys recovery.
      await refresh().catch(() => undefined)
    } finally {
      setBusy(false)
    }
  }

  const addQuestion = (submitEvent: SubmitEvent) => {
    submitEvent.preventDefault()
    void run(async () => {
      await api.addQuestion(eventId, {
        label: draft.label,
        type: draft.type,
        // The column is nullable and "not set" has exactly one representation,
        // so an empty box is null rather than an empty string.
        help_text: draft.help_text.trim() === '' ? null : draft.help_text,
        required: draft.required,
        options: null,
      })
      setDraft(BLANK)
    }, 'Could not add the question.')
  }

  const move = (questions: readonly FormQuestion[], index: number, by: -1 | 1) => {
    const target = index + by
    if (target < 0 || target >= questions.length) return

    const ids = questions.map((row) => row.id)
    const moved = ids[index]
    const displaced = ids[target]
    if (moved === undefined || displaced === undefined) return
    ids[index] = displaced
    ids[target] = moved

    void run(() => api.reorderQuestions(eventId, ids).then(() => undefined), 'Could not reorder.')
  }

  if (loaded.status === 'loading') return <p class="form-note">Loading questions…</p>

  if (loaded.status === 'failed') {
    return (
      <p class="form-error" role="alert">
        {loaded.message}
      </p>
    )
  }

  return (
    <section class="questions">
      <h3>Application questions</h3>

      {error !== undefined && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}

      {loaded.questions.length === 0 && (
        <p class="form-note">No questions yet. The application form will be empty until you add one.</p>
      )}

      <ol class="question-list">
        {loaded.questions.map((row, index) => (
          <li key={row.id}>
            {editing === row.id ? (
              <QuestionFields
                question={row}
                busy={busy}
                onCancel={() => setEditing(undefined)}
                onSave={(changes) =>
                  void run(async () => {
                    await api.updateQuestion(row.id, changes)
                    setEditing(undefined)
                  }, 'Could not save the question.')
                }
              />
            ) : (
              <>
                <span class="question-label">{row.label}</span>{' '}
                <span class="form-note">
                  {TYPES.find((entry) => entry.value === row.type)?.label ?? row.type}
                  {row.required ? ' · required' : ''}
                </span>
                <button
                  type="button"
                  class="link-button"
                  disabled={busy || index === 0}
                  aria-label={`Move "${row.label}" up`}
                  onClick={() => move(loaded.questions, index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  class="link-button"
                  disabled={busy || index === loaded.questions.length - 1}
                  aria-label={`Move "${row.label}" down`}
                  onClick={() => move(loaded.questions, index, 1)}
                >
                  ↓
                </button>
                <button type="button" class="link-button" onClick={() => setEditing(row.id)}>
                  Edit
                </button>
                <button
                  type="button"
                  class="link-button"
                  disabled={busy}
                  onClick={() =>
                    void run(() => api.deleteQuestion(row.id).then(() => undefined), 'Could not delete.')
                  }
                >
                  Remove
                </button>
              </>
            )}
          </li>
        ))}
      </ol>

      <form class="form" onSubmit={addQuestion}>
        <label class="field">
          <span>New question</span>
          <input
            required
            maxLength={500}
            value={draft.label}
            onInput={(inputEvent) => setDraft({ ...draft, label: inputEvent.currentTarget.value })}
          />
        </label>

        <label class="field">
          <span>Type</span>
          <select
            value={draft.type}
            onChange={(changeEvent) =>
              setDraft({ ...draft, type: toQuestionType(changeEvent.currentTarget.value, draft.type) })
            }
          >
            {TYPES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <label class="field">
          <span>Help text (optional)</span>
          <input
            maxLength={2000}
            value={draft.help_text}
            onInput={(inputEvent) => setDraft({ ...draft, help_text: inputEvent.currentTarget.value })}
          />
        </label>

        <label class="field-inline">
          <input
            type="checkbox"
            checked={draft.required}
            onChange={(changeEvent) => setDraft({ ...draft, required: changeEvent.currentTarget.checked })}
          />
          <span>Required</span>
        </label>

        <button type="submit" disabled={busy}>
          Add question
        </button>
      </form>
    </section>
  )
}

/** The edit form for one existing question. Split out to keep the list readable. */
const QuestionFields = ({
  question,
  busy,
  onSave,
  onCancel,
}: {
  question: FormQuestion
  busy: boolean
  onSave: (changes: {
    label: string
    type: FormQuestionType
    help_text: string | null
    required: boolean
  }) => void
  onCancel: () => void
}) => {
  const [label, setLabel] = useState(question.label)
  const [type, setType] = useState(question.type)
  const [helpText, setHelpText] = useState(question.help_text ?? '')
  const [required, setRequired] = useState(question.required)

  return (
    <div class="question-edit">
      <label class="field">
        <span>Label</span>
        {/*
          No `required`: this is a `<div>`, not a `<form>`, and Save is a
          `type="button"`, so there is no constraint validation to run — the
          attribute would look like a guard while doing nothing. The disabled
          button below is the actual guard, and it makes this path behave like
          the add form, which is a real form and blocks the same input.
        */}
        <input
          maxLength={500}
          value={label}
          onInput={(inputEvent) => setLabel(inputEvent.currentTarget.value)}
        />
      </label>

      <label class="field">
        <span>Type</span>
        <select
          value={type}
          onChange={(changeEvent) => setType(toQuestionType(changeEvent.currentTarget.value, type))}
        >
          {TYPES.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>

      <label class="field">
        <span>Help text</span>
        <input
          maxLength={2000}
          value={helpText}
          onInput={(inputEvent) => setHelpText(inputEvent.currentTarget.value)}
        />
      </label>

      <label class="field-inline">
        <input
          type="checkbox"
          checked={required}
          onChange={(changeEvent) => setRequired(changeEvent.currentTarget.checked)}
        />
        <span>Required</span>
      </label>

      <button
        type="button"
        disabled={busy || label.trim() === ''}
        onClick={() => onSave({ label, type, help_text: helpText.trim() === '' ? null : helpText, required })}
      >
        Save question
      </button>
      <button type="button" class="link-button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}
