import { useRef, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { FormError, useFormError } from '../components/FormError.tsx'
import { useSetViewer, useViewer } from '../viewer.tsx'

/**
 * The three failures a login can produce, each wanting different behaviour.
 *
 * Deliberately not `failure.message`, which `messageFor` in the API client
 * already produces: this page can be more specific than a generic API error
 * ("sign-in attempts" rather than "attempts"), and a login form is where that
 * specificity is worth most. The near-duplicate 429 copy in the two places is
 * intentional rather than drift — if one is edited, decide about the other
 * rather than assuming they must match.
 */
const messageForFailure = (failure: unknown): string => {
  if (!isApiError(failure)) return 'Could not sign in just now. Please try again.'
  if (failure.status === 401) return 'That email and password did not match.'
  if (failure.status === 429) return 'Too many sign-in attempts just now. Wait a few seconds and try again.'

  return 'Could not sign in just now. Please try again.'
}

/**
 * Sign in.
 *
 * There is no "forgot password" and no sign-up link, deliberately: accounts are
 * created only by redeeming an invite (#17), and there is no mail service to
 * send a reset through (#30). An admin resets a password out of band until
 * either exists — saying so here is better than a dead link.
 */
export const Login = ({ api }: { api: Pick<ApiClient, 'login'> }) => {
  const viewer = useViewer()
  const setViewer = useSetViewer()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useFormError()
  const [submitting, setSubmitting] = useState(false)

  // A ref rather than the `submitting` state, because state updates are
  // asynchronous: two clicks in the same tick both read `submitting === false`
  // and both submit. Double-clicking a login button is ordinary, and each
  // attempt costs the server a ~200ms scrypt hash.
  const inFlight = useRef(false)

  if (viewer.status === 'loading') {
    // Not the form. `viewer.tsx` introduced `loading` precisely so the nav does
    // not render signed-out and then swap; rendering the form here would put
    // the same flicker back on the page where it is most confusing — a member
    // already signed in, opening /login directly, sees a login form for a
    // moment and reasonably starts typing into it.
    return (
      <section class="page">
        <h1>Log in</h1>
        <p class="form-note">One moment…</p>
      </section>
    )
  }

  if (viewer.status === 'signed-in') {
    return (
      <section class="page">
        <h1>You are signed in</h1>
        <p>
          <a href="/">Go to the homepage</a>.
        </p>
      </section>
    )
  }

  const submit = async (event: Event) => {
    event.preventDefault()
    if (inFlight.current) return

    inFlight.current = true
    setSubmitting(true)
    setError(undefined)

    try {
      const { viewer: signedIn } = await api.login({ email, password })
      if (signedIn === null) {
        // The API answers 401 for a failed login, so a 200 with no viewer is a
        // contradiction rather than a rejection. Saying "wrong password" would
        // send someone hunting for a typo that is not there.
        setError('Signed in, but the server did not say who as. Please try again.')
        return
      }

      setViewer({ id: signedIn.account_id, name: signedIn.name, roles: signedIn.roles })
    } catch (failure) {
      // Three cases, because they want different behaviour from the member.
      //
      // 401 covers a wrong password and an unknown address alike — the API
      // refuses to distinguish them, so neither does this copy. 429 is the
      // login gate shedding; saying "try again" there invites exactly the
      // immediate retry `Retry-After` exists to prevent, which is why
      // `rate_limited` was added to the vocabulary in the first place.
      setError(messageForFailure(failure))
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }

  return (
    <section class="page">
      <h1>Log in</h1>

      {/*
        No `noValidate`: it suppresses constraint validation on submit, which
        makes the `required` attributes below inert — an empty form would POST
        `{ email: '', password: '' }`, get a 401, and tell the member their
        details did not match a form they never filled in. Letting the browser
        handle it also catches a mistyped address before a round trip.
      */}
      <form class="form" onSubmit={submit}>
        <label class="field">
          <span>Email</span>
          <input
            type="email"
            name="email"
            autocomplete="username"
            required
            value={email}
            onInput={(event) => setEmail(event.currentTarget.value)}
          />
        </label>

        <label class="field">
          <span>Password</span>
          <input
            type="password"
            name="password"
            autocomplete="current-password"
            required
            value={password}
            onInput={(event) => setPassword(event.currentTarget.value)}
          />
        </label>

        <FormError error={error} />

        <button type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Log in'}
        </button>
      </form>

      <p class="form-note">
        Accounts are created by invitation, so there is nothing to sign up for here. If you have lost your
        password, ask someone with admin — there is no mail service to send a reset through yet.
      </p>
    </section>
  )
}
