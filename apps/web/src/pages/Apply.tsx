import type { AnswerProblem, FormQuestion, SubmittedAnswers } from '@sage-burner/shared'

import {
  answerProblems,
  isTickBox,
  looksLikeEmail,
  MAX_ANSWER_LENGTH,
  MAX_APPLICANT_EMAIL_LENGTH,
  MAX_APPLICANT_NAME_LENGTH,
} from '@sage-burner/shared'
import { useCallback, useMemo, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { ErrorText } from '../components/ErrorText.tsx'
import { FormError } from '../components/FormError.tsx'
import { PendingButton } from '../components/PendingButton.tsx'
import { useInstallationSendsEmail } from '../installation.tsx'
import { useAction, useLoad } from '../load.ts'
import { renderMarkdown } from '../markdown.ts'
import { rowsFor } from '../textarea.ts'

/**
 * The public application form.
 *
 * Nothing about the questions is hardcoded here — that is the whole point of
 * #12 storing them as rows. This renders whatever `GET /api/questions` returns,
 * in the order an admin put them in, so adding a question never means a
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

const problemText = (reason: AnswerProblem['reason']) => {
  if (reason === 'unchecked') return 'Please tick this to continue.'
  if (reason === 'missing') return 'Please answer this.'
  if (reason === 'too_long') return `Please keep this under ${MAX_ANSWER_LENGTH.toLocaleString()} characters.`

  return 'That answer is not valid.'
}

/** Mirrors `nonEmptyText(max)`, which trims before it bounds, so both sides agree. */
const identityProblem = (value: string, max: number) => {
  const trimmed = value.trim()
  if (trimmed === '') return 'blank'
  if (trimmed.length > max) return 'too_long'

  return undefined
}

/**
 * The same answers for the address, plus the one only it can have.
 *
 * Checked here rather than left to the 400: this is where the invite will be posted,
 * and a typo caught on submit costs a correction where a typo caught by nobody costs
 * an application that silently goes nowhere. `looksLikeEmail` is the shared shape
 * rule, deliberately looser than `emailSchema`, which is what actually refuses one.
 */
const emailProblem = (value: string) =>
  identityProblem(value, MAX_APPLICANT_EMAIL_LENGTH) ?? (looksLikeEmail(value) ? undefined : 'malformed')

/**
 * The controls below are `aria-required`, not natively `required`, because
 * native validation blocks submission before this page's handler runs — leaving
 * the browser to decide the empty cases and `answerProblems` the rest. The
 * browser is the weaker of the two: it accepts `"   "`, and it does not know an
 * `agreement` must be ticked rather than merely present.
 */

/**
 * What the page says once it has been sent.
 *
 * The copy has to be true either way: with a mail server the invite arrives at the
 * address they typed, and without one it does not, so promising it would be a promise
 * the installation cannot keep (#30). `undefined` is the answer still arriving, and
 * takes the cautious half.
 */
const Sent = ({ sendsEmail }: { sendsEmail?: boolean }) => (
  <article>
    <h1>Application sent</h1>
    <p role="status">
      Thank you — we have your application. We read them together before each burn.{' '}
      {sendsEmail === true
        ? 'If you are accepted, your invite arrives at the address you gave us.'
        : 'Someone will get back to you at the address you gave us.'}{' '}
      Nothing else will arrive in your inbox in the meantime.
    </p>
  </article>
)

/** The problems are `field:reason`, so a field is flagged whatever its reason. */
const hasProblem = (problems: string[], field: string) =>
  problems.some((problem) => problem.startsWith(`${field}:`))

export const Apply = ({ api }: ApplyProps) => {
  const sendsEmail = useInstallationSendsEmail()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [answers, setAnswers] = useState<SubmittedAnswers>({})
  const [problems, setProblems] = useState<AnswerProblem[]>([])
  const [identityProblems, setIdentityProblems] = useState<string[]>([])
  const [sent, setSent] = useState(false)

  // Public, so there is no role to wait for — this is the one load in the app that
  // starts on mount whoever is looking.
  // No `fallback`: the page has its own wording for a failed load, below.
  const { loaded } = useLoad(async (signal) => (await api.getQuestions(signal)).questions, {})
  const questions: FormQuestion[] | undefined = loaded.status === 'ready' ? loaded.data : undefined
  const loadFailed = loaded.status === 'failed'

  const { busy: sending, formError: sendError, setError: setSendError, run } = useAction()

  // Once per load, not once per keystroke: `answer()` sets `answers`, so this
  // component re-renders on every character typed, and the help text this exists
  // to render is the longest thing on the form.
  const helpHtml = useMemo(() => {
    const byId = new Map<string, string>()
    for (const question of questions ?? []) {
      if (question.help_text !== null) byId.set(question.id, renderMarkdown(question.help_text))
    }

    return byId
  }, [questions])

  const problemFor = useMemo(() => {
    const byId = new Map(problems.map((problem) => [problem.question_id, problem]))

    return (id: string) => byId.get(id)
  }, [problems])

  const answer = useCallback((id: string, value: string | boolean) => {
    setAnswers((current) => ({ ...current, [id]: value }))
  }, [])

  const submit = () => {
    // Every rule passes vacuously against a list that has not arrived.
    if (questions === undefined) return

    const found = answerProblems(questions, answers)
    const nameProblem = identityProblem(name, MAX_APPLICANT_NAME_LENGTH)
    const addressProblem = emailProblem(email)
    const identity = [
      ...(nameProblem === undefined ? [] : [`applicant_name:${nameProblem}`]),
      ...(addressProblem === undefined ? [] : [`applicant_email:${addressProblem}`]),
    ]
    setProblems(found)
    setIdentityProblems(identity)
    setSendError(undefined)
    if (found.length > 0 || identity.length > 0) return

    run(
      async () => {
        await api.submitApplication({
          applicant_name: name.trim(),
          applicant_email: email.trim(),
          answers,
          // What this page put on screen, which is not necessarily what the server
          // holds now: a question added while it was open is not one the applicant
          // was asked, and storing an empty answer for it would say otherwise.
          asked: questions.map((question) => question.id),
        })
        setSent(true)
      },
      // A 400 means the questions changed since this page loaded, so retrying sends
      // an identical body and fails identically. The answers stay on screen either
      // way. A function rather than a string, since the wording turns on the status.
      (failure) =>
        isApiError(failure) && failure.status === 400
          ? 'The questions changed while you were filling this in. Please reload the page and send it again.'
          : 'Could not send your application. Please check your connection and try again.',
    )
  }

  if (sent) return <Sent sendsEmail={sendsEmail} />

  return (
    <article>
      <h1>Apply to join</h1>

      <form
        class="form"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        {loadFailed && <ErrorText message="Could not load the questions. Please reload the page." />}

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
          <ErrorText
            id="applicant_name-error"
            message={
              identityProblems.includes('applicant_name:too_long')
                ? `Please keep this under ${MAX_APPLICANT_NAME_LENGTH} characters.`
                : 'Please tell us your name.'
            }
          />
        )}

        <label class="field">
          <span>Your email address</span>
          <input
            name="applicant_email"
            // `type="email"` for the keyboard a phone offers, not for the validation:
            // `aria-required` above says why the browser's own is not what decides.
            type="email"
            maxLength={MAX_APPLICANT_EMAIL_LENGTH}
            autocomplete="email"
            aria-required
            aria-invalid={hasProblem(identityProblems, 'applicant_email')}
            aria-describedby={
              hasProblem(identityProblems, 'applicant_email') ? 'applicant_email-error' : undefined
            }
            value={email}
            onInput={(event) => setEmail(event.currentTarget.value)}
          />
        </label>
        {hasProblem(identityProblems, 'applicant_email') && (
          <ErrorText
            id="applicant_email-error"
            message={
              identityProblems.includes('applicant_email:too_long')
                ? `Please keep this under ${MAX_APPLICANT_EMAIL_LENGTH} characters.`
                : identityProblems.includes('applicant_email:malformed')
                  ? 'That does not look like an email address.'
                  : 'Please give us an email address — it is where your invite would go.'
            }
          />
        )}

        {questions?.length === 0 && (
          <p class="form-note">
            There are no questions on the form yet — just tell us who you are and how to reach you, and we
            will take it from there.
          </p>
        )}

        {questions?.map((question) => {
          const problem = problemFor(question.id)
          const help = helpHtml.get(question.id)
          const helpId = help === undefined ? undefined : `${question.id}-help`
          const errorId = problem === undefined ? undefined : `${question.id}-error`
          // Both, when both apply: announcing the error by replacing the
          // description would drop the explanation of how to answer.
          const describedBy = [helpId, errorId].filter((id) => id !== undefined).join(' ')
          const described = describedBy === '' ? undefined : describedBy
          const written = typeof answers[question.id] === 'string' ? String(answers[question.id]) : ''

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
                    // A click on a checkbox does not reliably raise `input`.
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
                    rows={rowsFor(written)}
                    aria-required={question.required}
                    aria-invalid={problem !== undefined}
                    aria-describedby={described}
                    value={written}
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

              {help !== undefined && (
                // A div, not a p: markdown renders block content, and a list
                // inside a paragraph is invalid HTML the browser silently
                // reshapes. Escaped rather than filtered — see `markdown.ts`.
                <div
                  class="form-note markdown-preview"
                  id={helpId}
                  dangerouslySetInnerHTML={{ __html: help }}
                />
              )}

              {problem !== undefined && <ErrorText id={errorId} message={problemText(problem.reason)} />}
            </div>
          )
        })}

        <FormError error={sendError} />

        {/* Beside the button rather than in the footer alone: this is the form where
            somebody hands over contact details before having an account, so it is the one
            page where the policy is worth reading *before* the click. */}
        <p class="form-note">
          What happens to what you write here is in the <a href="/privacy">privacy policy</a>.
        </p>

        <PendingButton
          busy={sending}
          label="Send application"
          busyLabel="Sending…"
          type="submit"
          disabled={questions === undefined}
        />
      </form>
    </article>
  )
}
