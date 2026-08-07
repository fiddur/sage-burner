import type { FormQuestion, FormQuestionType } from '@sage-burner/shared'

import {
  MAX_NOTES,
  MAX_QUESTION_LABEL,
  formQuestionTypes,
  isFormQuestionType,
  tickBoxRequired,
} from '@sage-burner/shared'
import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { swap } from '../reorder.ts'
import { ErrorText } from './ErrorText.tsx'
import { MarkdownField } from './MarkdownField.tsx'

export type QuestionsApi = Pick<
  ApiClient,
  'addQuestion' | 'deleteQuestion' | 'getQuestions' | 'reorderQuestions' | 'updateQuestion'
>

type Loaded =
  | { status: 'loading' }
  | { status: 'ready'; questions: readonly FormQuestion[] }
  | { status: 'failed'; message: string }

/**
 * Built from `formQuestionTypes` through a total `Record`, so adding a fifth type
 * to the vocabulary is a type error here rather than a silent omission from both
 * selects — which is what made the "`formQuestionTypes` is where a fifth type
 * will be added" note below true rather than aspirational.
 */
const TYPE_LABELS: Record<FormQuestionType, string> = {
  text: 'Short text',
  textarea: 'Long text',
  checkbox: 'Checkbox',
  agreement: 'Agreement (must be ticked)',
}

const TYPES = formQuestionTypes.map((value) => ({ value, label: TYPE_LABELS[value] }))

const BLANK = { label: '', type: 'textarea' as FormQuestionType, help_text: '', required: true }

/**
 * `required` is decided by the type for the two tick-box types, not by the
 * admin. The rule itself comes from `tickBoxRequired` in the shared package,
 * so this control cannot drift from what the API and the database enforce — which
 * is what happened when the rule was written out separately in each place.
 */
const requiredFor = (type: FormQuestionType, chosen: boolean) => tickBoxRequired(type) ?? chosen

const isFixed = (type: FormQuestionType) => tickBoxRequired(type) !== undefined

const requiredNote = (type: FormQuestionType) => {
  if (type === 'agreement') return ' (always, for an agreement)'
  if (type === 'checkbox') return ' (not applicable to a checkbox)'
  return ''
}

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
 * The application form's questions — one central set, not one per burn.
 *
 * These are rows rather than code precisely so an admin can retune them
 * between burns without a deploy — so everything here writes through the API
 * and re-reads, rather than keeping a clever local model that could disagree
 * with what the public form will actually render.
 *
 * Reordering sends the **whole** list of ids. The API rejects a partial one:
 * moving one question renumbers several, and a half-applied reorder is an order
 * nobody chose.
 */
export const QuestionEditor = ({ api }: { api: QuestionsApi }) => {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [draft, setDraft] = useState(BLANK)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [editing, setEditing] = useState<string | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()

    api
      .getQuestions(controller.signal)
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
  }, [api])

  // Every mutation re-reads rather than patching local state. One extra request
  // per change, and in exchange what is on screen is what the public form will
  // render — including the `order` values the server assigned.
  const refresh = async () => {
    const response = await api.getQuestions()
    setLoaded({ status: 'ready', questions: response.questions })
  }

  const run = async (work: () => Promise<void>, fallback: string) => {
    if (busy) return
    setBusy(true)
    setError(undefined)
    try {
      await work()
      // Outside the `catch` below, and with its own message. Inside the `try`
      // this reported `fallback` — "Could not add the question." — for a question
      // that was already in the database, with the draft cleared. The exact
      // inverse of the failure this component is otherwise careful about:
      // pretending the change *didn't* take.
      await refresh().catch(() => {
        setError('Saved, but the list could not be reloaded.')
      })
    } catch (failure) {
      setError(messageFor(failure, fallback))
      // Re-read on failure too, or the one error the API deliberately produces
      // becomes a dead end: another admin adds a question, this list is now
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
      await api.addQuestion({
        label: draft.label,
        type: draft.type,
        // The column is nullable and "not set" has exactly one representation,
        // so an empty box is null rather than an empty string.
        help_text: draft.help_text.trim() === '' ? null : draft.help_text,
        required: requiredFor(draft.type, draft.required),
      })
      setDraft(BLANK)
    }, 'Could not add the question.')
  }

  const move = (questions: readonly FormQuestion[], index: number, by: -1 | 1) => {
    const ids = swap(
      questions.map((row) => row.id),
      index,
      by,
    )
    if (ids === undefined) return

    void run(() => api.reorderQuestions(ids).then(() => undefined), 'Could not reorder.')
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

      <ErrorText message={error} />

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
              <div class="question-row">
                <span class="question-label">{row.label}</span>
                <span class="form-note">
                  {TYPE_LABELS[row.type]}
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
                <button type="button" class="link-button" disabled={busy} onClick={() => setEditing(row.id)}>
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
              </div>
            )}
          </li>
        ))}
      </ol>

      <form class="form" onSubmit={addQuestion}>
        <label class="field">
          <span>New question</span>
          <input
            required
            maxLength={MAX_QUESTION_LABEL}
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

        <MarkdownField
          label="Help text (optional, markdown)"
          value={draft.help_text}
          maxLength={MAX_NOTES}
          onInput={(help_text) => setDraft({ ...draft, help_text })}
        />

        {/*
          Disabled for `agreement`, not merely defaulted: that type exists because
          submission is blocked when it is unticked, so an optional agreement is a
          contradiction. The API refuses it too — this makes the rule visible
          instead of turning a tick into a 400.
        */}
        <label class="field-inline">
          <input
            type="checkbox"
            checked={requiredFor(draft.type, draft.required)}
            disabled={isFixed(draft.type)}
            onChange={(changeEvent) => setDraft({ ...draft, required: changeEvent.currentTarget.checked })}
          />
          <span>Required{requiredNote(draft.type)}</span>
        </label>

        {/*
          Also disabled on a whitespace-only label. `required` does not catch
          `'   '` — it satisfies HTML constraint validation, the form submits, and
          `nonEmptyText(500)` trims it to `''` server-side, so the admin reads
          the unmapped "Request failed (400)". This is what makes the parity with
          the edit form below real rather than only true for a genuinely empty box.
        */}
        <button type="submit" disabled={busy || draft.label.trim() === ''}>
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
          maxLength={MAX_QUESTION_LABEL}
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

      <MarkdownField
        label="Help text (markdown)"
        value={helpText}
        maxLength={MAX_NOTES}
        onInput={setHelpText}
      />

      <label class="field-inline">
        <input
          type="checkbox"
          checked={requiredFor(type, required)}
          disabled={isFixed(type)}
          onChange={(changeEvent) => setRequired(changeEvent.currentTarget.checked)}
        />
        <span>Required{requiredNote(type)}</span>
      </label>

      <button
        type="button"
        disabled={busy || label.trim() === ''}
        onClick={() =>
          onSave({
            label,
            type,
            help_text: helpText.trim() === '' ? null : helpText,
            required: requiredFor(type, required),
          })
        }
      >
        Save question
      </button>
      <button type="button" class="link-button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}
