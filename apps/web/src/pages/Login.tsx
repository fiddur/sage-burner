import type { MeResponse } from '@sage-burner/shared'

import { apiRoutes, oauthProviderInfo, oauthProviders } from '@sage-burner/shared'
import { useRef, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { Ceremony, PasskeyApi } from '../passkey.ts'

import { isApiError } from '../api/client.ts'
import { FormError, useFormError } from '../components/FormError.tsx'
import { PendingButton } from '../components/PendingButton.tsx'
import { useSocialLogins } from '../installation.tsx'
import { useOauthOutcome } from '../outcome.ts'
import { messageForCeremony, passkeysWork, signInWithPasskey } from '../passkey.ts'
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
 * created only by redeeming an invite (#17), and there is no reset flow at all —
 * #30 gave the app a mail server, and nothing that sends a reset through it. An
 * admin resets a password out of band until
 * either exists — saying so here is better than a dead link.
 */
export const Login = ({
  api,
  ceremony,
  passkeys = passkeysWork(),
}: {
  api: Pick<ApiClient, 'login'> & PasskeyApi
  ceremony?: Ceremony
  /** Injectable: `navigator.credentials` is absent under happy-dom. */
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

  /**
   * What a provider round trip that came back here has to say.
   *
   * `unlinked` is the one that matters: it must read the same whether or not an account
   * exists for whatever address the provider holds, because this page is not an oracle.
   */
  const outcome = signInOutcome(useOauthOutcome())

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

  /**
   * Both ways in end here.
   *
   * The API answers 401 for a failed login, so a 200 with no viewer is a
   * contradiction rather than a rejection. Saying "wrong password" would send
   * someone hunting for a typo that is not there.
   */
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
      // Undefined for a dialog the member closed, which is not a failure to
      // report — the form is still there, and so is the button.
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
            // A link, not a fetch: the point is to leave for somebody else's consent screen,
            // which `fetch` cannot follow. Absent entirely where the installation has not set
            // a provider up — a button that cannot work reads as a promise.
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

/**
 * What the page says about a provider round trip that came back here.
 *
 * Exported so it is testable without a URL: the wording is the whole of what `unlinked` is
 * for, and it must not name whether an account exists.
 */
export const signInOutcome = (outcome: string | null): string | undefined => {
  if (outcome === 'unlinked') {
    return 'No account here is linked to that. Sign in another way, then link it under Your details.'
  }
  if (outcome === 'refused') return 'That did not work. Try again, or sign in with your password.'

  return undefined
}
