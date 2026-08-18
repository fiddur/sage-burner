import type { ResetStatus } from '@sage-burner/shared'

import { forgottenPage, loginPage, MIN_PASSWORD } from '@sage-burner/shared'
import { useLocation } from 'preact-iso'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { ErrorText } from '../components/ErrorText.tsx'
import { FormError } from '../components/FormError.tsx'
import { PendingButton } from '../components/PendingButton.tsx'
import { useAction, useLoad } from '../load.ts'
import { useSetViewer } from '../viewer.tsx'
import { landsOn } from './Login.tsx'

export type ResetApi = Pick<ApiClient, 'getPasswordResetState' | 'resetPassword'>

const messageForFailure = (failure: unknown): string => {
  if (!isApiError(failure)) return 'Could not set that password. Please try again.'
  if (failure.status === 409) {
    return 'This link has been used already, or has run out. Ask for a fresh one and try again.'
  }
  if (failure.status === 429 || failure.code === 'network') return failure.message

  return 'Could not set that password. Please try again.'
}

const explanationFor = (status: Exclude<ResetStatus, 'outstanding'>): string =>
  status === 'expired'
    ? 'This link has run out. Ask for a fresh one and it will be with you in a moment.'
    : 'We do not recognise this link. Check you copied all of it, or ask for a fresh one.'

export const Reset = ({ api, token }: { api: ResetApi; token: string }) => {
  const setViewer = useSetViewer()
  const { route } = useLocation()
  const [password, setPassword] = useState('')
  const { busy, formError: error, setError, run } = useAction()

  const { loaded } = useLoad(async (signal) => await api.getPasswordResetState(token, signal), {
    key: token,
    fallback: 'Could not check this link. Please reload the page.',
  })

  if (loaded.status === 'loading') {
    return (
      <section class="page column">
        <h1>Set a new password</h1>
        <p class="form-note">One moment…</p>
      </section>
    )
  }

  if (loaded.status === 'failed') {
    return (
      <section class="page column">
        <h1>Set a new password</h1>
        <ErrorText message={loaded.message} />
      </section>
    )
  }

  if (loaded.data.status !== 'outstanding') {
    return (
      <section class="page column">
        <h1>Set a new password</h1>
        <ErrorText message={explanationFor(loaded.data.status)} />
        <p class="home-actions">
          <a href={forgottenPage()}>Ask for a fresh link</a>
          <a href={loginPage()}>Log in</a>
        </p>
      </section>
    )
  }

  const submit = (event: Event) => {
    event.preventDefault()
    if (password.length < MIN_PASSWORD) {
      setError(`A password needs at least ${MIN_PASSWORD} characters.`)

      return
    }

    run(async () => {
      const { viewer } = await api.resetPassword(token, { password })
      if (viewer === null) {
        setError('Your password was changed, but the server did not say who as. Log in with it.')

        return
      }

      setViewer({
        id: viewer.account_id,
        name: viewer.name,
        avatar: viewer.avatar,
        roles: viewer.roles,
      })
      route(landsOn(viewer.roles), true)
    }, messageForFailure)
  }

  return (
    <section class="page column">
      <h1>Set a new password</h1>
      <p>This link works once. Choosing a password here signs you in with it.</p>

      <form class="form" onSubmit={submit}>
        <label class="field">
          <span>New password</span>
          <input
            type="password"
            name="password"
            autocomplete="new-password"
            required
            minLength={MIN_PASSWORD}
            aria-describedby="password-floor"
            value={password}
            onInput={(event) => setPassword(event.currentTarget.value)}
          />
          <span class="form-note" id="password-floor">
            At least {MIN_PASSWORD} characters.
          </span>
        </label>

        <FormError error={error} />

        <PendingButton busy={busy} label="Set it" busyLabel="Setting it…" type="submit" />
      </form>
    </section>
  )
}
