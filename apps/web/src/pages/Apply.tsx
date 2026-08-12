import type {
  AnswerProblem,
  ApplicationMessage,
  FormQuestion,
  MyApplication,
  SubmittedAnswers,
} from '@sage-burner/shared'

import {
  answerProblems,
  detailsPage,
  isTickBox,
  looksLikeEmail,
  MAX_ANSWER_LENGTH,
  MAX_APPLICANT_EMAIL_LENGTH,
  MAX_APPLICANT_NAME_LENGTH,
} from '@sage-burner/shared'
import { useCallback, useMemo, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { PushApi } from '../components/PushToggle.tsx'
import type { SignUpApi } from '../components/SignUpForm.tsx'

import { isApiError } from '../api/client.ts'
import { useBurns } from '../burn.tsx'
import { ApplicationThread } from '../components/ApplicationThread.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { FormError } from '../components/FormError.tsx'
import { PendingButton } from '../components/PendingButton.tsx'
import { PushToggle } from '../components/PushToggle.tsx'
import { SignUpForm } from '../components/SignUpForm.tsx'
import { useInstallationSendsEmail } from '../installation.tsx'
import { useAction, useLoad } from '../load.ts'
import { renderMarkdown } from '../markdown.ts'
import { useOauthOutcome } from '../outcome.ts'
import { rowsFor } from '../textarea.ts'
import { isMember, useSetViewer, useViewer } from '../viewer.tsx'

export type ApplyApi = Pick<
  ApiClient,
  'getQuestions' | 'submitApplication' | 'getMyApplication' | 'sendMyApplicationMessage'
> &
  PushApi &
  SignUpApi

interface ApplyProps {
  api: ApplyApi
}

const problemText = (reason: AnswerProblem['reason']) => {
  if (reason === 'unchecked') return 'Please tick this to continue.'
  if (reason === 'missing') return 'Please answer this.'
  if (reason === 'too_long') return `Please keep this under ${MAX_ANSWER_LENGTH.toLocaleString()} characters.`

  return 'That answer is not valid.'
}

const identityProblem = (value: string, max: number) => {
  const trimmed = value.trim()
  if (trimmed === '') return 'blank'
  if (trimmed.length > max) return 'too_long'

  return undefined
}

/** Blank is not a problem: the account's own address is what the server falls back to (#510). */
const emailProblem = (value: string) =>
  value.trim() === ''
    ? undefined
    : (identityProblem(value, MAX_APPLICANT_EMAIL_LENGTH) ??
      (looksLikeEmail(value) ? undefined : 'malformed'))

const Waiting = ({ sendsEmail, api }: { sendsEmail?: boolean; api: PushApi }) => (
  <>
    <h1>Application sent</h1>
    <p role="status">
      Thank you — we have your application. We read them together before each burn.{' '}
      {sendsEmail === true
        ? 'If you do not get a notification or an email, you can check back here.'
        : 'If you do not get a notification, you can check back here.'}
    </p>

    <PushToggle api={api} />
  </>
)

const Talk = ({ api, messages }: { api: ApplyApi; messages: readonly ApplicationMessage[] }) => {
  const [said, setSaid] = useState<readonly ApplicationMessage[] | undefined>(undefined)
  const { busy, error, run } = useAction()

  return (
    <ApplicationThread
      messages={said ?? messages}
      busy={busy}
      error={error}
      subject="the organisers"
      onSay={(body) =>
        run(
          async () => setSaid((await api.sendMyApplicationMessage({ body })).messages),
          'Could not send that. Please try again.',
        )
      }
    />
  )
}

const Answered = ({
  approved,
  organisers,
  joined,
}: {
  approved: boolean
  organisers: MyApplication['organisers']
  joined: string | undefined
}) =>
  approved ? (
    <>
      <h1>You are in</h1>
      <p role="status">
        Welcome. You are a member here now.{' '}
        {joined === undefined
          ? 'Every burn being planned is open to you — join the one you are coming to and say when you arrive.'
          : `You were added to ${joined}, so all that is left is to say when you arrive and leave — or to leave the burn, if you know you cannot come.`}{' '}
        <a href={detailsPage()}>Your details</a> is where both of those are. Either way you are welcome to
        stay and watch the planning; the next burn will be announced here as well.
      </p>
    </>
  ) : (
    <>
      <h1>Your application</h1>
      <p role="status">
        This one has not been accepted. If you would like to know more, the organisers are the people to ask.
      </p>

      {organisers.length > 0 && (
        <ul class="plain-list">
          {organisers.map((who) => (
            <li key={who.account_id}>
              {who.name ?? 'An organiser'}
              {who.contact !== null && who.contact !== '' && ` — ${who.contact}`}
            </li>
          ))}
        </ul>
      )}
    </>
  )

const hasProblem = (problems: string[], field: string) =>
  problems.some((problem) => problem.startsWith(`${field}:`))

/**
 * Which of the four things somebody sees, which is the whole of what account-first changed here
 * (#476): sign up, fill the form in, wait, or read the answer.
 */
export const Apply = ({ api }: ApplyProps) => {
  const viewer = useViewer()
  const { burns } = useBurns()
  const joinedBurnName = burns.find((one) => one.attendance !== null)?.event.name
  const setViewer = useSetViewer()
  const sendsEmail = useInstallationSendsEmail()
  const { outcome } = useOauthOutcome()
  const [sent, setSent] = useState(false)

  const { loaded: standing } = useLoad(async (signal) => (await api.getMyApplication(signal)).mine, {
    enabled: viewer.status === 'signed-in',
    fallback: 'Could not load your application.',
  })
  const mine = standing.status === 'ready' ? standing.data : undefined

  if (viewer.status === 'loading') return <article class="column" />

  if (viewer.status === 'signed-out') {
    return (
      <article class="column">
        <h1>Apply to join</h1>
        {outcome === 'no-address' && (
          <p class="form-note" role="alert">
            That provider did not give us an email address, and an account needs one. Sign up with an address
            and a password instead — you can link the provider afterwards under Your details.
          </p>
        )}
        <SignUpForm
          api={api}
          arrive={(signedIn) => {
            if (signedIn === null) return

            setViewer({
              id: signedIn.account_id,
              name: signedIn.name,
              avatar: signedIn.avatar,
              roles: signedIn.roles,
            })
          }}
        />
      </article>
    )
  }

  if (mine?.application != null && mine.application.status !== 'pending') {
    return (
      <article class="column">
        <Answered
          approved={mine.application.status === 'approved'}
          organisers={mine.organisers}
          joined={joinedBurnName}
        />
        <Talk api={api} messages={mine.messages} />
      </article>
    )
  }

  if (sent || mine?.application != null) {
    return (
      <article class="column">
        <Waiting sendsEmail={sendsEmail} api={api} />
        {mine !== undefined && <Talk api={api} messages={mine.messages} />}
      </article>
    )
  }

  return (
    <NotAppliedYet
      api={api}
      standing={standing.status}
      knownName={viewer.account?.name ?? ''}
      member={isMember(viewer)}
      onSent={() => setSent(true)}
    />
  )
}

/** Nothing of theirs to show yet — but a blank form is a claim they have not applied. */
const NotAppliedYet = ({
  api,
  standing,
  knownName,
  member,
  onSent,
}: {
  api: ApplyApi
  standing: 'loading' | 'ready' | 'failed'
  knownName: string
  member: boolean
  onSent: () => void
}) => {
  if (standing === 'loading') {
    return (
      <article class="column">
        <p class="form-note">Loading…</p>
      </article>
    )
  }

  if (standing === 'failed') {
    return (
      <article class="column">
        <h1>Apply to join</h1>
        <ErrorText message="Could not check whether you have already applied. Please reload the page." />
      </article>
    )
  }

  if (member) {
    return (
      <article class="column">
        <h1>Apply to join</h1>
        <p class="form-note">
          You are a member here already, so there is nothing to apply for.{' '}
          <a href={detailsPage()}>Your details</a> is where your own record is.
        </p>
      </article>
    )
  }

  return <ApplicationForm api={api} knownName={knownName} onSent={onSent} />
}

const ApplicationForm = ({
  api,
  knownName,
  onSent,
}: {
  api: ApplyApi
  knownName: string
  onSent: () => void
}) => {
  const [name, setName] = useState(knownName)
  const [email, setEmail] = useState('')
  const [answers, setAnswers] = useState<SubmittedAnswers>({})
  const [problems, setProblems] = useState<AnswerProblem[]>([])
  const [identityProblems, setIdentityProblems] = useState<string[]>([])

  const { loaded } = useLoad(async (signal) => (await api.getQuestions(signal)).questions, {})
  const questions: FormQuestion[] | undefined = loaded.status === 'ready' ? loaded.data : undefined
  const loadFailed = loaded.status === 'failed'

  const { busy: sending, formError: sendError, setError: setSendError, run } = useAction()

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
          ...(email.trim() === '' ? {} : { applicant_email: email.trim() }),
          answers,
          asked: questions.map((question) => question.id),
        })
        onSent()
      },
      (failure) => {
        if (!isApiError(failure)) {
          return 'Could not send your application. Please check your connection and try again.'
        }
        if (failure.status === 400) {
          return 'The questions changed while you were filling this in. Please reload the page and send it again.'
        }
        if (failure.status === 409) {
          return failure.code === 'already_applied'
            ? 'Your application is already in — it was sent, and this page will show where it stands.'
            : 'You are already a member here — there is nothing to apply for. Log in the way you usually do.'
        }

        return 'Could not send your application. Please check your connection and try again.'
      },
    )
  }

  return (
    <article class="column">
      <h1>Apply to join</h1>

      <p class="form-note">
        Already a member? This is a new account — log out, sign in the way you usually do, and link the
        provider under <a href={detailsPage()}>Your details</a>.
      </p>

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
            type="email"
            maxLength={MAX_APPLICANT_EMAIL_LENGTH}
            autocomplete="email"
            aria-invalid={hasProblem(identityProblems, 'applicant_email')}
            aria-describedby={
              hasProblem(identityProblems, 'applicant_email') ? 'applicant_email-error' : undefined
            }
            value={email}
            onInput={(event) => setEmail(event.currentTarget.value)}
          />
        </label>
        <p class="form-note">
          Left blank, we write to the address you signed in with. Fill it in only if something else would
          reach you better.
        </p>
        {hasProblem(identityProblems, 'applicant_email') && (
          <ErrorText
            id="applicant_email-error"
            message={
              identityProblems.includes('applicant_email:too_long')
                ? `Please keep this under ${MAX_APPLICANT_EMAIL_LENGTH} characters.`
                : 'That does not look like an email address.'
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
