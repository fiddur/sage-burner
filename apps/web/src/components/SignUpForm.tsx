import type { MeResponse } from '@sage-burner/shared'

import { apiRoutes, MAX_EMAIL, MAX_PERSON_NAME, MIN_PASSWORD, oauthProviderInfo } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { useSocialLogins } from '../installation.tsx'
import { useAction } from '../load.ts'
import { ErrorText } from './ErrorText.tsx'
import { PendingButton } from './PendingButton.tsx'

export type SignUpApi = Pick<ApiClient, 'signUp'>

export const messageForSignUp = (failure: unknown): string => {
  if (isApiError(failure) && failure.status === 409) {
    return 'There is already an account with that address. Log in instead — and if it is not yours, use another address.'
  }
  if (isApiError(failure) && failure.status === 429) {
    return 'That is a lot of accounts from one place. Please wait a little and try again.'
  }
  if (isApiError(failure) && failure.status === 400) {
    return `Check what you gave: a name, an address that looks like an email, and a password of at least ${MIN_PASSWORD} characters.`
  }

  return 'Could not make your account. Please check your connection and try again.'
}

export const SignUpForm = ({
  api,
  arrive,
}: {
  api: SignUpApi
  arrive: (viewer: MeResponse['viewer']) => void
}) => {
  const offered = useSocialLogins()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { busy, error, run } = useAction()

  return (
    <>
      <p class="form-note">
        Applying starts with an account, so we have somewhere to answer you and you have somewhere to look.
      </p>

      {offered.length > 0 && (
        <p class="row">
          {offered.map((provider) => (
            <a key={provider} class="link-button" href={apiRoutes.startOauthSignIn.path(provider)}>
              Continue with {oauthProviderInfo[provider].label}
            </a>
          ))}
        </p>
      )}

      <form
        class="form"
        onSubmit={(submitted) => {
          submitted.preventDefault()
          run(
            async () => arrive((await api.signUp({ name: name.trim(), email, password })).viewer),
            messageForSignUp,
          )
        }}
      >
        <label class="field">
          <span>Your real name</span>
          <input
            type="text"
            name="name"
            maxLength={MAX_PERSON_NAME}
            autocomplete="name"
            required
            value={name}
            onInput={(typed) => setName(typed.currentTarget.value)}
          />
        </label>

        <label class="field">
          <span>Your email address</span>
          <input
            type="email"
            name="email"
            maxLength={MAX_EMAIL}
            autocomplete="username"
            required
            value={email}
            onInput={(typed) => setEmail(typed.currentTarget.value)}
          />
        </label>

        <label class="field">
          <span>A password</span>
          <input
            type="password"
            name="password"
            autocomplete="new-password"
            required
            minLength={MIN_PASSWORD}
            aria-describedby="password-floor"
            value={password}
            onInput={(typed) => setPassword(typed.currentTarget.value)}
          />
          <span class="form-note" id="password-floor">
            At least {MIN_PASSWORD} characters. Length is what makes one hard to guess — a few words you will
            remember beats something short and clever.
          </span>
        </label>

        <ErrorText message={error} />

        <PendingButton busy={busy} label="Sign up" busyLabel="Signing up…" type="submit" />
      </form>

      <p class="form-note">
        Already have an account? <a href="/login">Log in</a>.
      </p>
    </>
  )
}
