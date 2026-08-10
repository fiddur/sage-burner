import type { MeResponse } from '@sage-burner/shared'

import { apiRoutes, oauthProviderInfo, oauthProviders } from '@sage-burner/shared'
import { useRef, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { Ceremony, PasskeyApi } from '../passkey.ts'

import { isApiError } from '../api/client.ts'
import { FormError, useFormError } from '../components/FormError.tsx'
import { PendingButton } from '../components/PendingButton.tsx'
import { useSocialLogins } from '../installation.tsx'
import { quoting, useOauthOutcome } from '../outcome.ts'
import { messageForCeremony, passkeysWork, signInWithPasskey } from '../passkey.ts'
import { useSetViewer, useViewer } from '../viewer.tsx'

const messageForFailure = (failure: unknown): string => {
  if (!isApiError(failure)) return 'Could not sign in just now. Please try again.'
  if (failure.status === 401) return 'That email and password did not match.'
  if (failure.status === 429) return 'Too many sign-in attempts just now. Wait a few seconds and try again.'

  return 'Could not sign in just now. Please try again.'
}

export const Login = ({
  api,
  ceremony,
  passkeys = passkeysWork(),
}: {
  api: Pick<ApiClient, 'login'> & PasskeyApi
  ceremony?: Ceremony
  passkeys?: boolean
}) => {
  const viewer = useViewer()
  const setViewer = useSetViewer()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useFormError()
  const [submitting, setSubmitting] = useState(false)
  const configured = useSocialLogins()
  const offered = oauthProviders.filter((provider) => configured.includes(provider))

  const { outcome: came, ref } = useOauthOutcome()
  const outcome = signInOutcome(came, ref)

  const inFlight = useRef(false)

  if (viewer.status === 'loading') {
    return (
      <section class="page column">
        <h1>Log in</h1>
        <p class="form-note">One moment…</p>
      </section>
    )
  }

  if (viewer.status === 'signed-in') {
    return (
      <section class="page column">
        <h1>You are signed in</h1>
        <p>
          <a href="/">Go to the homepage</a>.
        </p>
      </section>
    )
  }

  const arrive = (signedIn: MeResponse['viewer']) => {
    if (signedIn === null) {
      setError('Signed in, but the server did not say who as. Please try again.')
      return
    }

    setViewer({
      id: signedIn.account_id,
      name: signedIn.name,
      avatar: signedIn.avatar,
      roles: signedIn.roles,
    })
  }

  const withPasskey = async () => {
    if (inFlight.current) return

    inFlight.current = true
    setSubmitting(true)
    setError(undefined)

    try {
      arrive((await signInWithPasskey(api, ceremony)).viewer)
    } catch (failure) {
      setError(messageForCeremony(failure, 'That passkey did not sign you in. Try your password instead.'))
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }

  const submit = async (event: Event) => {
    event.preventDefault()
    if (inFlight.current) return

    inFlight.current = true
    setSubmitting(true)
    setError(undefined)

    try {
      arrive((await api.login({ email, password })).viewer)
    } catch (failure) {
      setError(messageForFailure(failure))
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }

  return (
    <section class="page column">
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

        <PendingButton busy={submitting} label="Log in" busyLabel="Signing in…" type="submit" />
      </form>

      {passkeys && (
        <p class="row">
          {/*
            Outside the form on purpose: inside it, a browser that ignores
            `type="button"` would submit the empty email and password and answer a
            401 over a ceremony that had not failed.
          */}
          <button type="button" disabled={submitting} onClick={() => void withPasskey()}>
            Use a passkey
          </button>
          <span class="form-note">If you have registered one on this device.</span>
        </p>
      )}

      {offered.length > 0 && (
        <p class="row">
          {offered.map((provider) => (
            <a key={provider} class="link-button" href={apiRoutes.startOauthSignIn.path(provider)}>
              Continue with {oauthProviderInfo[provider].label}
            </a>
          ))}
        </p>
      )}

      {outcome !== undefined && (
        <p class="form-note" role="alert">
          {outcome}
        </p>
      )}

      <p class="form-note">
        Accounts are created by invitation, so there is nothing to sign up for here. If you have lost your
        password, ask someone with admin — this app cannot send you a reset link.
      </p>
    </section>
  )
}

export const signInOutcome = (outcome: string | null, ref: string | null = null): string | undefined => {
  const quote = quoting(ref)

  if (outcome === 'unlinked') {
    return 'No account here is linked to that. Sign in another way, then link it under Your details.'
  }
  if (outcome === 'misconfigured') {
    return `That provider refused the connection, so it is not set up correctly here. Sign in with your password, and please tell an organiser.${quote}`
  }
  if (outcome === 'unreachable') {
    return `That provider could not be reached. Try again in a moment, or sign in with your password; if it keeps happening, tell an organiser.${quote}`
  }
  if (outcome === 'refused') return 'That did not work. Try again, or sign in with your password.'

  return undefined
}
