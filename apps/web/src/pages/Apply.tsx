import type { AnswerProblem, FormQuestion, SubmittedAnswers } from '@sage-burner/shared'

import {
  MAX_ANSWER_LENGTH,
  MAX_APPLICANT_CONTACT_LENGTH,
  MAX_APPLICANT_NAME_LENGTH,
  answerProblems,
  isTickBox,
} from '@sage-burner/shared'
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
  if (reason === 'too_long') return `Please keep this under ${MAX_ANSWER_LENGTH.toLocaleString()} characters.`

  return 'That answer is not valid.'
}

/**
 * The identity fields' own rules, mirroring `nonEmptyText(max)` exactly.
 *
 * Both halves matter and both were missing at first. `.trim().min(1)` means
 * `"   "` is refused, while the browser's `required` accepts it; `.max(n)` means
 * a long paste is refused, and nothing in the browser stops one.
 *
 * Either gap put the applicant in the same dead end — a 400 the page could only
 * explain as "the questions changed, reload", which throws away what they wrote
 * and fails identically on the retry.
 */
const identityProblem = (value: string, max: number) => {
  if (value.trim() === '') return 'blank'
  if (value.length > max) return 'too_long'

  return undefined
}

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

/** The problems are `field:reason`, so a field is flagged whatever its reason. */
const hasProblem = (problems: string[], field: string) =>
  problems.some((problem) => problem.startsWith(`${field}:`))

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
    const nameProblem = identityProblem(name, MAX_APPLICANT_NAME_LENGTH)
    const contactProblem = identityProblem(contact, MAX_APPLICANT_CONTACT_LENGTH)
    const identity = [
      ...(nameProblem === undefined ? [] : [`applicant_name:${nameProblem}`]),
      ...(contactProblem === undefined ? [] : [`applicant_contact:${contactProblem}`]),
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
            maxLength={MAX_APPLICANT_NAME_LENGTH}
            aria-required
            aria-invalid={hasProblem(identityProblems, 'applicant_name')}
            aria-describedby={
              hasProblem(identityProblems, 'applicant_name') ? 'applicant_name-error' : undefined
            }
            value={name}
            onInput={(event) => setName(event.currentTarget.value)}
          />
        </label>
        {hasProblem(identityProblems, 'applicant_name') && (
          <p class="form-error" role="alert" id="applicant_name-error">
            {identityProblems.includes('applicant_name:too_long')
              ? `Please keep this under ${MAX_APPLICANT_NAME_LENGTH} characters.`
              : 'Please tell us your name.'}
          </p>
        )}

        <label class="field">
          <span>How can we reach you?</span>
          <input
            name="applicant_contact"
            type="text"
            maxLength={MAX_APPLICANT_CONTACT_LENGTH}
            aria-required
            aria-invalid={hasProblem(identityProblems, 'applicant_contact')}
            aria-describedby={
              hasProblem(identityProblems, 'applicant_contact') ? 'applicant_contact-error' : undefined
            }
            value={contact}
            onInput={(event) => setContact(event.currentTarget.value)}
          />
        </label>
        {hasProblem(identityProblems, 'applicant_contact') && (
          <p class="form-error" role="alert" id="applicant_contact-error">
            {identityProblems.includes('applicant_contact:too_long')
              ? `Please keep this under ${MAX_APPLICANT_CONTACT_LENGTH} characters.`
              : 'Please give us an email address or a phone number.'}
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
                    maxLength={MAX_ANSWER_LENGTH}
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
                    maxLength={MAX_ANSWER_LENGTH}
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
