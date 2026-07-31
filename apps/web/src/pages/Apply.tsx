import type { AnswerProblem, FormQuestion, SubmittedAnswers } from '@sage-burner/shared'

import { answerProblems, isTickBox } from '@sage-burner/shared'
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

/**
 * The public application form.
 *
 * Nothing about the questions is hardcoded here — that is the whole point of
 * #12 storing them as rows. This renders whatever `GET /api/questions` returns,
 * in the order an organiser put them in, so adding a question never means a
 * deploy.
 *
 * The form is reachable without a session, because an applicant does not have
 * one yet.
 */

/** Exactly what this page calls, so a test stub is a plain object rather than a cast. */
export type ApplyApi = Pick<ApiClient, 'getQuestions' | 'submitApplication'>

interface ApplyProps {
  api: ApplyApi
}

/**
 * What to say about a field the applicant has not filled in properly.
 *
 * Keyed off the same `answerProblems` the server refuses on, so the form cannot
 * call a submission complete that the API then rejects.
 */
const problemText = (reason: AnswerProblem['reason']) => {
  if (reason === 'unchecked') return 'Please tick this to continue.'
  if (reason === 'missing') return 'Please answer this.'

  return 'That answer is not valid.'
}

export const Apply = ({ api }: ApplyProps) => {
  const [questions, setQuestions] = useState<FormQuestion[] | undefined>(undefined)
  const [loadFailed, setLoadFailed] = useState(false)
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [answers, setAnswers] = useState<SubmittedAnswers>({})
  const [problems, setProblems] = useState<AnswerProblem[]>([])
  const [sendError, setSendError] = useState<string | undefined>(undefined)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    api
      .getQuestions(controller.signal)
      .then((response) => {
        // Sorted here rather than trusted from the wire: the ordering is what an
        // organiser arranged, and a form that renders it differently from the
        // admin preview is a bug an organiser cannot diagnose.
        setQuestions([...response.questions].sort((a, b) => a.order - b.order))
      })
      .catch(() => {
        // Distinguished from "no questions yet": an empty form after a failed
        // load would invite someone to apply without answering anything.
        if (!controller.signal.aborted) setLoadFailed(true)
      })

    return () => controller.abort()
  }, [api])

  const problemFor = useMemo(() => {
    const byId = new Map(problems.map((problem) => [problem.question_id, problem]))

    return (id: string) => byId.get(id)
  }, [problems])

  const answer = useCallback((id: string, value: string | boolean) => {
    setAnswers((current) => ({ ...current, [id]: value }))
  }, [])

  const submit = async () => {
    // Guarded by the disabled button as well, so this is the belt to that
    // brace: validating against a list that has not arrived would pass every
    // rule vacuously and send an empty application the server then refuses.
    if (questions === undefined) return

    const found = answerProblems(questions, answers)
    setProblems(found)
    setSendError(undefined)
    if (found.length > 0) return

    setSending(true)
    try {
      await api.submitApplication({
        applicant_name: name,
        applicant_contact: contact,
        answers,
      })
      setSent(true)
    } catch {
      // The answers stay on screen. A dropped connection losing a long written
      // answer is the one failure here that costs the applicant real work.
      setSendError('Could not send your application. Please try again.')
    } finally {
      setSending(false)
    }
  }

  if (sent) {
    return (
      <article>
        <h1>Application sent</h1>
        <p role="status">
          Thank you — we have your application. We read them together before each burn, and someone will get
          back to you at the contact you gave us. There is no automatic email, so nothing will arrive in your
          inbox in the meantime.
        </p>
      </article>
    )
  }

  return (
    <article>
      <h1>Apply to join</h1>

      {loadFailed && (
        <p class="form-error" role="alert">
          Could not load the questions. Please reload the page.
        </p>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <p>
          <label for="applicant_name">Your name</label>
          <input
            id="applicant_name"
            name="applicant_name"
            type="text"
            required
            value={name}
            onInput={(event) => setName(event.currentTarget.value)}
          />
        </p>

        <p>
          <label for="applicant_contact">How can we reach you?</label>
          <input
            id="applicant_contact"
            name="applicant_contact"
            type="text"
            required
            value={contact}
            onInput={(event) => setContact(event.currentTarget.value)}
          />
        </p>

        {(questions ?? []).map((question) => {
          const problem = problemFor(question.id)
          const describedBy = question.help_text === null ? undefined : `${question.id}-help`

          return (
            <p key={question.id}>
              <label for={question.id}>{question.label}</label>

              {question.help_text !== null && <span id={describedBy}>{question.help_text}</span>}

              {isTickBox(question.type) ? (
                <input
                  id={question.id}
                  name={question.id}
                  type="checkbox"
                  aria-describedby={describedBy}
                  checked={answers[question.id] === true}
                  // `onChange`, matching `QuestionEditor` — a click on a checkbox
                  // does not reliably raise `input`.
                  onChange={(event) => answer(question.id, event.currentTarget.checked)}
                />
              ) : question.type === 'textarea' ? (
                <textarea
                  id={question.id}
                  name={question.id}
                  aria-describedby={describedBy}
                  value={typeof answers[question.id] === 'string' ? String(answers[question.id]) : ''}
                  onInput={(event) => answer(question.id, event.currentTarget.value)}
                />
              ) : (
                <input
                  id={question.id}
                  name={question.id}
                  type="text"
                  aria-describedby={describedBy}
                  value={typeof answers[question.id] === 'string' ? String(answers[question.id]) : ''}
                  onInput={(event) => answer(question.id, event.currentTarget.value)}
                />
              )}

              {problem !== undefined && (
                <span class="form-error" role="alert">
                  {problemText(problem.reason)}
                </span>
              )}
            </p>
          )
        })}

        {sendError !== undefined && (
          <p class="form-error" role="alert">
            {sendError}
          </p>
        )}

        {/*
          Disabled until the questions are known: submitting before they arrive
          would mean answering a form nobody has seen, and the server — which
          reads the questions itself — would refuse it.
        */}
        <button type="submit" disabled={sending || questions === undefined}>
          {sending ? 'Sending…' : 'Send application'}
        </button>
      </form>
    </article>
  )
}
