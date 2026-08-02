import type { InviteState } from '@sage-burner/shared'

import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { FormError, useFormError } from '../components/FormError.tsx'
import { useSetViewer, useViewer } from '../viewer.tsx'

export type InviteApi = Pick<ApiClient, 'getInviteState' | 'redeemInvite'>

type Loaded = { status: 'loading' } | { status: 'ready'; state: InviteState } | { status: 'failed' }

/**
 * Spending an invitation: the page where someone becomes a member.
 *
 * The controls are `aria-required` rather than natively `required`, and carry no
 * `minLength`, for the reason the application form gives: native validation
 * blocks submission before this handler runs, which would leave the browser
 * deciding the empty cases and this page the rest. The browser's rules are the
 * weaker ones — it accepts `"   "` for a name.
 */
export const Invite = ({ api, token }: { api: InviteApi; token: string }) => {
  const viewer = useViewer()
  const setViewer = useSetViewer()
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [allergies, setAllergies] = useState('')
  const [error, setError] = useFormError()
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    api
      .getInviteState(token, controller.signal)
      .then((state) => {
        if (!controller.signal.aborted) setLoaded({ status: 'ready', state })
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoaded({ status: 'failed' })
      })

    return () => controller.abort()
  }, [api, token])

  const submit = async () => {
    setError(undefined)
    if (email.trim() === '') {
      setError('Please give us an email address — it becomes your login.')
      return
    }
    if (name.trim() === '') {
      setError('Please tell us your name.')
      return
    }
    if (password === '') {
      setError('Please choose a password.')
      return
    }

    setSending(true)
    try {
      const { viewer: signedIn } = await api.redeemInvite(token, {
        email,
        password,
        name: name.trim(),
        allergies_notes: allergies.trim() === '' ? null : allergies.trim(),
      })
      // The cookie is set server-side, but the shared viewer is populated once on
      // mount and not refetched on client-side navigation — so without this the
      // nav still offers "Log in" to someone holding a valid session. `Login.tsx`
      // does the same thing after its own sign-in.
      if (signedIn !== null) setViewer({ id: signedIn.account_id, roles: signedIn.roles })
      setDone(true)
    } catch (failure) {
      // A 409 means the invite went while this page was open, or the email is
      // already an account. Either way the answer is not "try again" — the same
      // request fails the same way.
      setError(
        isApiError(failure) && failure.status === 409
          ? 'That invite has already been used, or there is already an account with that email. Ask someone with admin for a fresh link.'
          : 'Could not finish signing you up. Please check your connection and try again.',
      )
    } finally {
      setSending(false)
    }
  }

  if (done) {
    return (
      <section class="page">
        <h1>Welcome</h1>
        <p role="status">
          You are in, and signed in. Next you can say which burn you are coming to, and fill in the details
          for it.
        </p>
        <p class="home-actions">
          <a href="/">Go to the start page</a>
        </p>
      </section>
    )
  }

  if (viewer.status === 'signed-in') {
    // Redeeming would create a second account for the same human, and the page
    // has no way to tell whether that is what they meant.
    return (
      <section class="page">
        <h1>You are already signed in</h1>
        <p>
          Log out first if you meant to redeem this invite for a different person, or{' '}
          <a href="/">go to the start page</a>.
        </p>
      </section>
    )
  }

  if (loaded.status === 'loading') {
    return (
      <section class="page">
        <h1>Your invitation</h1>
        <p class="form-note">One moment…</p>
      </section>
    )
  }

  if (loaded.status === 'failed') {
    return (
      <section class="page">
        <h1>Your invitation</h1>
        <p class="form-error" role="alert">
          Could not check this invitation. Please reload the page.
        </p>
      </section>
    )
  }

  if (loaded.state.status !== 'outstanding') {
    // Three different dead ends, three different things to do about them — an
    // expired link can be re-sent, a used one probably means you already have an
    // account, and an unknown one is usually a truncated paste.
    const explanation = {
      expired: 'This invitation has expired. Ask someone with admin for a fresh one.',
      used: 'This invitation has already been used. If that was you, log in instead.',
      unknown: 'We do not recognise this invitation link. Check you copied all of it.',
    }[loaded.state.status]

    return (
      <section class="page">
        <h1>Your invitation</h1>
        <p class="form-error" role="alert">
          {explanation}
        </p>
        <p class="home-actions">
          <a href="/login">Log in</a>
          <a href="/">Start page</a>
        </p>
      </section>
    )
  }

  return (
    <section class="page">
      <h1>Welcome — let us set you up</h1>

      <p class="form-note">
        This invitation is good for one person. The email and password become your login; the rest is for
        planning. Food is primarily vegetarian, with vegan options.
      </p>

      <form
        class="form"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <label class="field">
          <span>Email</span>
          <input
            type="email"
            name="email"
            autocomplete="username"
            aria-required
            value={email}
            onInput={(event) => setEmail(event.currentTarget.value)}
          />
        </label>

        <label class="field">
          <span>Password</span>
          <input
            type="password"
            name="password"
            autocomplete="new-password"
            aria-required
            value={password}
            onInput={(event) => setPassword(event.currentTarget.value)}
          />
        </label>

        <label class="field">
          <span>Your name</span>
          <input
            type="text"
            name="name"
            maxLength={200}
            aria-required
            value={name}
            onInput={(event) => setName(event.currentTarget.value)}
          />
        </label>

        <label class="field">
          <span>Allergies or food you cannot eat (optional)</span>
          <span class="form-note">Food is primarily vegetarian, with vegan options.</span>
          <textarea
            name="allergies_notes"
            maxLength={2000}
            value={allergies}
            onInput={(event) => setAllergies(event.currentTarget.value)}
          />
        </label>

        <p class="form-note">
          We cook together, so this is read by whoever plans the meals. You can change it later.
        </p>

        <FormError error={error} />

        <button type="submit" disabled={sending}>
          {sending ? 'Setting you up…' : 'Join'}
        </button>
      </form>
    </section>
  )
}
