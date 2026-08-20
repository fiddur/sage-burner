import { loginPage, RESET_VALID_HOURS } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { FormError } from '../components/FormError.tsx'
import { PendingButton } from '../components/PendingButton.tsx'
import { useCanResetPassword } from '../installation.tsx'
import { useAction } from '../load.ts'

export type ForgottenApi = Pick<ApiClient, 'requestPasswordReset'>

const BackToLogin = () => (
  <p class="home-actions">
    <a href={loginPage()}>Back to logging in</a>
  </p>
)

export const Forgotten = ({ api }: { api: ForgottenApi }) => {
  const canReset = useCanResetPassword()
  const [email, setEmail] = useState('')
  const [asked, setAsked] = useState(false)
  const { busy, formError: error, setError, run } = useAction()

  if (canReset === undefined) {
    return (
      <section class="page column">
        <h1>Forgotten your password?</h1>
        <p class="form-note">One moment…</p>
      </section>
    )
  }

  if (!canReset) {
    return (
      <section class="page column">
        <h1>Forgotten your password?</h1>
        <p>
          No link can be sent from here just now — this installation has no mail server set up, does not know
          its own address, or could not be asked. An organiser can set a new password for you.
        </p>
        <BackToLogin />
      </section>
    )
  }

  if (asked) {
    return (
      <section class="page column">
        <h1>Have a look in your inbox</h1>
        <p role="status">
          If there is an account for {email}, a link to set a new password is on its way. It works once, and
          for the next {RESET_VALID_HOURS} hours.
        </p>
        <p class="form-note">
          Nothing arrived? Check the address you gave, and wherever your mail files things it is unsure about.
        </p>
        <BackToLogin />
      </section>
    )
  }

  const submit = (event: Event) => {
    event.preventDefault()
    if (email.trim() === '') {
      setError('Please give the address you sign in with.')

      return
    }

    run(async () => {
      await api.requestPasswordReset({ email })
      setAsked(true)
    }, 'Could not ask for that just now. Please try again.')
  }

  return (
    <section class="page column">
      <h1>Forgotten your password?</h1>
      <p>Give the address you sign in with and we will post you a link to set a new one.</p>

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

        <FormError error={error} />

        <PendingButton busy={busy} label="Send me a link" busyLabel="Asking…" type="submit" />
      </form>

      <BackToLogin />
    </section>
  )
}
