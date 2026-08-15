import type { FormQuestion, FormQuestionType } from '@sage-burner/shared'

import {
  formQuestionTypes,
  isFormQuestionType,
  MAX_NOTES,
  MAX_QUESTION_LABEL,
  tickBoxRequired,
} from '@sage-burner/shared'
import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { Destroy } from './Destroy.tsx'
import { ErrorText } from './ErrorText.tsx'
import { MarkdownField } from './MarkdownField.tsx'
import { ReorderableList } from './ReorderableList.tsx'

export type QuestionsApi = Pick<
  ApiClient,
  'addQuestion' | 'deleteQuestion' | 'getQuestions' | 'reorderQuestions' | 'updateQuestion'
>

type Loaded =
  | { status: 'loading' }
  | { status: 'ready'; questions: readonly FormQuestion[] }
  | { status: 'failed'; message: string }

const TYPE_LABELS: Record<FormQuestionType, string> = {
  text: 'Short text',
  textarea: 'Long text',
  checkbox: 'Checkbox',
  agreement: 'Agreement (must be ticked)',
}

const TYPES = formQuestionTypes.map((value) => ({ value, label: TYPE_LABELS[value] }))

interface Draft {
  label: string
  type: FormQuestionType
  help_text: string
  required: boolean
}

const BLANK: Draft = { label: '', type: 'textarea', help_text: '', required: true }

const requiredFor = (type: FormQuestionType, chosen: boolean) => tickBoxRequired(type) ?? chosen

const isFixed = (type: FormQuestionType) => tickBoxRequired(type) !== undefined

const requiredNote = (type: FormQuestionType) => {
  if (type === 'agreement') return ' (always, for an agreement)'
  if (type === 'checkbox') return ' (not applicable to a checkbox)'
  return ''
}

const messageFor = (failure: unknown, fallback: string) => (isApiError(failure) ? failure.message : fallback)

const toQuestionType = (value: string, fallback: FormQuestionType) =>
  isFormQuestionType(value) ? value : fallback

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
      await refresh().catch(() => {
        setError('Saved, but the list could not be reloaded.')
      })
    } catch (failure) {
      setError(messageFor(failure, fallback))
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
        help_text: draft.help_text.trim() === '' ? null : draft.help_text,
        required: requiredFor(draft.type, draft.required),
      })
      setDraft(BLANK)
    }, 'Could not add the question.')
  }

  const reorderTo = (ids: string[]) => {
    void run(() => api.reorderQuestions(ids).then(() => undefined), 'Could not reorder.')
  }

  if (loaded.status === 'loading') return <p class="form-note">Loading questions…</p>

  if (loaded.status === 'failed') {
    return <ErrorText message={loaded.message} />
  }

  return (
    <section class="questions">
      <h3>Application questions</h3>

      <ErrorText message={error} />

      {loaded.questions.length === 0 && (
        <p class="form-note">No questions yet. The application form will be empty until you add one.</p>
      )}

      <ReorderableList
        rows={loaded.questions}
        busy={busy}
        rowClass="question-row"
        labelFor={(row) => `"${row.label}"`}
        onReorder={reorderTo}
      >
        {(row) =>
          editing === row.id ? (
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
              <span class="question-label reorder-name">{row.label}</span>
              <span class="form-note">
                {TYPE_LABELS[row.type]}
                {row.required ? ' · required' : ''}
              </span>
              <button type="button" class="link-button" disabled={busy} onClick={() => setEditing(row.id)}>
                Edit
              </button>
              <Destroy
                what={row.label}
                because="Answers already given to it stay on the applications."
                trigger="Remove"
                busy={busy}
                onDestroy={() =>
                  void run(() => api.deleteQuestion(row.id).then(() => undefined), 'Could not delete.')
                }
              />
            </>
          )
        }
      </ReorderableList>

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

        <label class="field-inline">
          <input
            type="checkbox"
            checked={requiredFor(draft.type, draft.required)}
            disabled={isFixed(draft.type)}
            onChange={(changeEvent) => setDraft({ ...draft, required: changeEvent.currentTarget.checked })}
          />
          <span>Required{requiredNote(draft.type)}</span>
        </label>

        {/* Also disabled on a whitespace-only label: `required` accepts `' '` and the server trims it away. */}
        <button type="submit" disabled={busy || draft.label.trim() === ''}>
          Add question
        </button>
      </form>
    </section>
  )
}

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
        {/* No `required`: this is a `div` with a `type="button"` Save, so nothing would validate it. */}
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

      <MarkdownField label="Help text" value={helpText} maxLength={MAX_NOTES} onInput={setHelpText} />

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
