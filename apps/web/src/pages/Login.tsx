import { useRef, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { useSetViewer, useViewer } from '../viewer.tsx'

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
  const [error, setError] = useState<string | undefined>(undefined)
  const [submitting, setSubmitting] = useState(false)

  // A ref rather than the `submitting` state, because state updates are
  // asynchronous: two clicks in the same tick both read `submitting === false`
  // and both submit. Double-clicking a login button is ordinary, and each
  // attempt costs the server a ~200ms scrypt hash.
  const inFlight = useRef(false)

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

      setViewer({ id: signedIn.account_id, roles: signedIn.roles })
    } catch (failure) {
      // 401 is the only expected failure and covers a wrong password and an
      // unknown address alike — the API refuses to distinguish them, so neither
      // does this copy.
      setError(
        isApiError(failure) && failure.status === 401
          ? 'That email and password did not match.'
          : 'Could not sign in just now. Please try again.',
      )
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }

  return (
    <section class="page">
      <h1>Log in</h1>

      <form class="form" onSubmit={submit} noValidate>
        {error !== undefined && (
          // `alert` so it is announced when it appears — a member using a
          // screen reader would otherwise resubmit a form that has already
          // told them what is wrong.
          <p class="form-error" role="alert">
            {error}
          </p>
        )}

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

        <button type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Log in'}
        </button>
      </form>

      <p class="form-note">
        Accounts are created by invitation, so there is nothing to sign up for here. If you have lost your
        password, ask an organiser — there is no mail service to send a reset through yet.
      </p>
    </section>
  )
}
