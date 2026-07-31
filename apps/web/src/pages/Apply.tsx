import type { AnswerProblem, FormQuestion, SubmittedAnswers } from '@sage-burner/shared'

import { answerProblems, isTickBox } from '@sage-burner/shared'
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'

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
 * Keyed off the same `answerProblems` the server refuses on, so the two agree
 * about a given set of questions.
 */
const problemText = (reason: AnswerProblem['reason']) => {
  if (reason === 'unchecked') return 'Please tick this to continue.'
  if (reason === 'missing') return 'Please answer this.'

  return 'That answer is not valid.'
}

/**
 * `nonEmptyText` is `.trim().min(1)`, and the browser's `required` only rejects
 * the empty string — so `"   "` passes every native check and is then refused by
 * the API. Checked here for the same reason the answers are: a submission this
 * form accepts should not come back as a 400 the applicant cannot act on.
 */
const blank = (value: string) => value.trim() === ''

/**
 * Why this form uses `aria-required` rather than the native `required` that
 * `Login` uses.
 *
 * Native validation blocks submission before the handler runs, so the browser
 * would decide the empty cases and this page the rest — two validators with
 * different verdicts. The browser's is the weaker of the two: it accepts
 * `"   "`, which the API refuses, and it has no idea an `agreement` must be
 * ticked rather than merely present.
 *
 * Leaving one authority means every message below is reachable and testable, and
 * the verdict the applicant sees is the same one `answerProblems` gives the
 * server. `aria-required` keeps the announcement; the visible `· required`
 * marker keeps it on screen.
 */

export const Apply = ({ api }: ApplyProps) => {
  const [questions, setQuestions] = useState<FormQuestion[] | undefined>(undefined)
  const [loadFailed, setLoadFailed] = useState(false)
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [answers, setAnswers] = useState<SubmittedAnswers>({})
  const [problems, setProblems] = useState<AnswerProblem[]>([])
  const [identityProblems, setIdentityProblems] = useState<string[]>([])
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
    // Guarded by the disabled button as well, so this is the belt to that brace:
    // validating against a list that has not arrived would pass every rule
    // vacuously and send an empty application the server then refuses.
    if (questions === undefined) return

    const found = answerProblems(questions, answers)
    const identity = [
      ...(blank(name) ? ['applicant_name'] : []),
      ...(blank(contact) ? ['applicant_contact'] : []),
    ]
    setProblems(found)
    setIdentityProblems(identity)
    setSendError(undefined)
    if (found.length > 0 || identity.length > 0) return

    setSending(true)
    try {
      // Trimmed, because that is what the server stores — `nonEmptyText` trims,
      // so sending the padding would only have it thrown away.
      await api.submitApplication({
        applicant_name: name.trim(),
        applicant_contact: contact.trim(),
        answers,
      })
      setSent(true)
    } catch (error) {
      // A 400 here means the server disagrees with this page about the questions
      // — one was added or removed since it loaded — so the two ran the same
      // rules against different lists. "Try again" would be false advice:
      // retrying sends an identical body and fails identically. Anything else is
      // a transport failure, where retrying is exactly right.
      //
      // The answers stay on screen either way. A dropped connection losing a
      // long written answer is the one failure here that costs real work.
      setSendError(
        isApiError(error) && error.status === 400
          ? 'The questions changed while you were filling this in. Please reload the page and send it again.'
          : 'Could not send your application. Please check your connection and try again.',
      )
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

      <form
        class="form"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        {loadFailed && (
          <p class="form-error" role="alert">
            Could not load the questions. Please reload the page.
          </p>
        )}

        <label class="field">
          <span>Your name</span>
          <input
            name="applicant_name"
            type="text"
            aria-required
            aria-invalid={identityProblems.includes('applicant_name')}
            aria-describedby={
              identityProblems.includes('applicant_name') ? 'applicant_name-error' : undefined
            }
            value={name}
            onInput={(event) => setName(event.currentTarget.value)}
          />
        </label>
        {identityProblems.includes('applicant_name') && (
          <p class="form-error" role="alert" id="applicant_name-error">
            Please tell us your name.
          </p>
        )}

        <label class="field">
          <span>How can we reach you?</span>
          <input
            name="applicant_contact"
            type="text"
            aria-required
            aria-invalid={identityProblems.includes('applicant_contact')}
            aria-describedby={
              identityProblems.includes('applicant_contact') ? 'applicant_contact-error' : undefined
            }
            value={contact}
            onInput={(event) => setContact(event.currentTarget.value)}
          />
        </label>
        {identityProblems.includes('applicant_contact') && (
          <p class="form-error" role="alert" id="applicant_contact-error">
            Please give us an email address or a phone number.
          </p>
        )}

        {questions?.length === 0 && (
          <p class="form-note">
            There are no questions on the form yet — just tell us who you are and how to reach you, and we
            will take it from there.
          </p>
        )}

        {questions?.map((question) => {
          const problem = problemFor(question.id)
          const helpId = question.help_text === null ? undefined : `${question.id}-help`
          const errorId = problem === undefined ? undefined : `${question.id}-error`
          // Both, when both apply: `aria-describedby` takes a list, and dropping
          // the help text in order to announce the error would remove the very
          // explanation that says how to answer.
          const describedBy = [helpId, errorId].filter((id) => id !== undefined).join(' ')
          const described = describedBy === '' ? undefined : describedBy

          return (
            <div key={question.id}>
              <label class={isTickBox(question.type) ? 'field-inline' : 'field'}>
                {isTickBox(question.type) && (
                  <input
                    name={question.id}
                    type="checkbox"
                    aria-required={question.required}
                    aria-invalid={problem !== undefined}
                    aria-describedby={described}
                    checked={answers[question.id] === true}
                    // `onChange`, matching `QuestionEditor` — a click on a
                    // checkbox does not reliably raise `input`.
                    onChange={(event) => answer(question.id, event.currentTarget.checked)}
                  />
                )}

                <span>
                  {question.label}
                  {question.required && <em class="required-marker"> · required</em>}
                </span>

                {question.type === 'textarea' && (
                  <textarea
                    name={question.id}
                    aria-required={question.required}
                    aria-invalid={problem !== undefined}
                    aria-describedby={described}
                    value={typeof answers[question.id] === 'string' ? String(answers[question.id]) : ''}
                    onInput={(event) => answer(question.id, event.currentTarget.value)}
                  />
                )}

                {question.type === 'text' && (
                  <input
                    name={question.id}
                    type="text"
                    aria-required={question.required}
                    aria-invalid={problem !== undefined}
                    aria-describedby={described}
                    value={typeof answers[question.id] === 'string' ? String(answers[question.id]) : ''}
                    onInput={(event) => answer(question.id, event.currentTarget.value)}
                  />
                )}
              </label>

              {question.help_text !== null && (
                <p class="form-note" id={helpId}>
                  {question.help_text}
                </p>
              )}

              {problem !== undefined && (
                <p class="form-error" role="alert" id={errorId}>
                  {problemText(problem.reason)}
                </p>
              )}
            </div>
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
