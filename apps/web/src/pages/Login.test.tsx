import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AppApi } from '../app.tsx'
import type { Ceremony, PasskeyApi } from '../passkey.ts'

import { apiError } from '../api/client.ts'
import { ViewerProvider } from '../viewer.tsx'
import { Login } from './Login.tsx'

/**
 * The login form against an injected client, so the assertions are about what a
 * member sees rather than about fetch being called.
 */

afterEach(cleanup)

/**
 * The passkey half is stubbed to reject: these tests are about the password form,
 * and a stub that resolved would let one of them pass while the ceremony it
 * silently ran did nothing. The `signing in with a passkey` block below supplies
 * its own.
 */
const noPasskeys = (): PasskeyApi => ({
  startPasskeyRegistration: () => Promise.reject(new Error('startPasskeyRegistration is not stubbed here')),
  addPasskey: () => Promise.reject(new Error('addPasskey is not stubbed here')),
  startPasskeyLogin: () => Promise.reject(new Error('startPasskeyLogin is not stubbed here')),
  finishPasskeyLogin: () => Promise.reject(new Error('finishPasskeyLogin is not stubbed here')),
})

const renderLogin = (login: AppApi['login']) =>
  render(
    <ViewerProvider viewer={{ status: 'signed-out' }}>
      <Login api={{ login, ...noPasskeys() }} />
    </ViewerProvider>,
  )

const fillIn = (email: string, password: string) => {
  fireEvent.input(screen.getByLabelText('Email'), { target: { value: email } })
  fireEvent.input(screen.getByLabelText('Password'), { target: { value: password } })
}

const submit = () => screen.getByRole('button', { name: 'Log in' }).click()

describe('Login', () => {
  it('sends what was typed', async () => {
    const login = vi.fn(() =>
      Promise.resolve({ viewer: { account_id: 'a-1', name: null, avatar: null, roles: [] } }),
    )
    renderLogin(login)

    fillIn('ada@example.org', 'a good long passphrase')
    submit()

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith({ email: 'ada@example.org', password: 'a good long passphrase' })
    })
  })

  it('shows one message for a wrong password and an unknown address alike', async () => {
    // The API refuses to distinguish them — 401 `invalid_credentials` for both
    // — so this copy must not either, or the message becomes the enumeration
    // oracle the API avoided.
    const login = vi.fn(() => Promise.reject(apiError(401, 'invalid_credentials', 'You need to sign in.')))
    renderLogin(login)

    fillIn('ada@example.org', 'wrong')
    submit()

    expect((await screen.findByRole('alert')).textContent).toBe('That email and password did not match.')
  })

  it('tells a rate-limited member to wait, rather than to try again', async () => {
    // The login gate sheds with 429 and `Retry-After`. "Please try again"
    // invites exactly the immediate retry that header exists to prevent — and
    // under a flood, that is the client behaviour that makes it worse. This is
    // what `rate_limited` was added to the vocabulary for.
    const login = vi.fn<AppApi['login']>(() =>
      Promise.reject(apiError(429, 'rate_limited', 'Too many attempts just now.')),
    )
    renderLogin(login)

    fillIn('ada@example.org', 'a good long passphrase')
    submit()

    const message = (await screen.findByRole('alert')).textContent
    expect(message).toContain('Wait a few seconds')
    // Specifically not the generic failure copy, which says only "Please try
    // again" and so invites the immediate retry.
    expect(message).not.toBe('Could not sign in just now. Please try again.')
  })

  it('distinguishes a server failure from a rejected password', async () => {
    // "That email and password did not match" would send someone hunting for a
    // typo when the database is down.
    const login = vi.fn(() => Promise.reject(apiError(500, 'internal_error', 'Something went wrong.')))
    renderLogin(login)

    fillIn('ada@example.org', 'a good long passphrase')
    submit()

    expect((await screen.findByRole('alert')).textContent).toContain('Could not sign in just now')
  })

  it('survives a network failure that is not an ApiError at all', async () => {
    const login = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    renderLogin(login)

    fillIn('ada@example.org', 'a good long passphrase')
    submit()

    expect((await screen.findByRole('alert')).textContent).toContain('Could not sign in just now')
  })

  it('re-enables the button after a failure, so a second attempt is possible', async () => {
    const login = vi.fn(() => Promise.reject(apiError(401, 'invalid_credentials', 'nope')))
    renderLogin(login)

    fillIn('ada@example.org', 'wrong')
    submit()

    await screen.findByRole('alert')
    const button = screen.getByRole('button', { name: 'Log in' })
    expect(button instanceof HTMLButtonElement && button.disabled).toBe(false)
  })

  it('does not submit twice while a request is in flight', async () => {
    // Double-clicking a login button is ordinary, and each attempt costs a
    // ~200ms scrypt hash on the server.
    let release = (_: { viewer: null }) => undefined as void
    const login = vi.fn(() => new Promise<{ viewer: null }>((resolve) => (release = resolve)))
    renderLogin(login)

    fillIn('ada@example.org', 'a good long passphrase')
    submit()
    submit()

    expect(login).toHaveBeenCalledTimes(1)
    release({ viewer: null })
  })

  it('announces the signed-in state rather than leaving the form up', async () => {
    const login = vi.fn(() =>
      Promise.resolve({
        viewer: { account_id: 'a-1', name: null, avatar: null, roles: ['member' as const] },
      }),
    )
    renderLogin(login)

    fillIn('ada@example.org', 'a good long passphrase')
    submit()

    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('You are signed in')
  })

  it('explains that a 200 without a viewer is not a rejected password', async () => {
    // The API answers 401 for a failed login, so this shape is a contradiction
    // rather than a refusal. Saying "wrong password" would send someone hunting
    // for a typo that is not there.
    const login = vi.fn(() => Promise.resolve({ viewer: null }))
    renderLogin(login)

    fillIn('ada@example.org', 'a good long passphrase')
    submit()

    expect((await screen.findByRole('alert')).textContent).toContain('did not say who')
  })

  it('does not post an empty form, which would be answered as a wrong password', async () => {
    // The form previously carried `noValidate`, which suppresses constraint
    // validation on submit and made the `required` attributes inert: an empty
    // submit POSTed `{ email: '', password: '' }`, got a 401, and told the
    // member their details did not match a form they never filled in.
    const login = vi.fn<AppApi['login']>(() => Promise.resolve({ viewer: null }))
    renderLogin(login)

    submit()

    expect(login).not.toHaveBeenCalled()
  })

  it('shows no form while the viewer is still loading', async () => {
    // A signed-in member opening /login directly would otherwise see the form
    // flash before it swaps — the same flicker `loading` was introduced in
    // viewer.tsx to avoid for the nav, reappearing where it is most likely to
    // be typed into.
    render(
      <ViewerProvider viewer={{ status: 'loading' }}>
        <Login api={{ login: vi.fn(() => Promise.resolve({ viewer: null })), ...noPasskeys() }} />
      </ViewerProvider>,
    )

    expect(screen.queryByLabelText('Email')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Log in' })).toBeNull()
  })

  it('says why there is no sign-up or password reset', async () => {
    // Both are absent by design — accounts come from invites (#17) and there is
    // no mail service (#30). A dead link would be worse than saying so.
    renderLogin(vi.fn(() => Promise.resolve({ viewer: null })))

    const note = await screen.findByText(/Accounts are created by invitation/)
    expect(note.textContent).toContain('ask someone with admin')
  })
})

describe('signing in with a passkey', () => {
  const ASSERTION: AuthenticationResponseJSON = {
    id: 'cred-1',
    rawId: 'cred-1',
    response: { clientDataJSON: 'client', authenticatorData: 'auth', signature: 'signature' },
    clientExtensionResults: {},
    type: 'public-key',
  }

  const ceremonyOf = (over: Partial<Ceremony> = {}): Ceremony => ({
    register: () => Promise.reject(new Error('not used here')),
    authenticate: () => Promise.resolve(ASSERTION),
    ...over,
  })

  const REQUEST_OPTIONS: PublicKeyCredentialRequestOptionsJSON = {
    challenge: 'from-the-server',
    rpId: 'burn.example.org',
  }

  const renderWithPasskeys = (
    api: Partial<PasskeyApi & Pick<AppApi, 'login'>>,
    ceremony = ceremonyOf(),
    passkeys = true,
  ) =>
    render(
      <ViewerProvider viewer={{ status: 'signed-out' }}>
        <Login
          api={{
            login: () => Promise.reject(new Error('login is not stubbed here')),
            ...noPasskeys(),
            ...api,
          }}
          ceremony={ceremony}
          passkeys={passkeys}
        />
      </ViewerProvider>,
    )

  it('signs in without an email or a password', async () => {
    // Usernameless: the browser offers whatever it holds for this domain, so
    // nothing is typed and nothing here says which addresses have accounts.
    const login = vi.fn<AppApi['login']>(() => Promise.reject(new Error('the password route was used')))
    const finish = vi.fn(() =>
      Promise.resolve({ viewer: { account_id: 'a-1', name: 'Ada', avatar: null, roles: [] } }),
    )
    renderWithPasskeys({
      login,
      startPasskeyLogin: () => Promise.resolve({ options: REQUEST_OPTIONS }),
      finishPasskeyLogin: finish,
    })

    screen.getByRole('button', { name: 'Use a passkey' }).click()

    expect(await screen.findByText('You are signed in')).toBeTruthy()
    expect(finish).toHaveBeenCalledWith({ response: ASSERTION })
    expect(login).not.toHaveBeenCalled()
  })

  it('says nothing when the member closes the dialog', async () => {
    const aborted = new Error('cancelled')
    aborted.name = 'NotAllowedError'
    renderWithPasskeys(
      { startPasskeyLogin: () => Promise.resolve({ options: { challenge: 'c' } }) },
      ceremonyOf({ authenticate: () => Promise.reject(aborted) }),
    )

    screen.getByRole('button', { name: 'Use a passkey' }).click()

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Use a passkey' }).hasAttribute('disabled')).toBe(false),
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('points at the password when the passkey is refused', async () => {
    renderWithPasskeys({
      startPasskeyLogin: () => Promise.resolve({ options: REQUEST_OPTIONS }),
      finishPasskeyLogin: () => Promise.reject(new Error('nope')),
    })

    screen.getByRole('button', { name: 'Use a passkey' }).click()

    expect((await screen.findByRole('alert')).textContent).toContain('Try your password instead.')
  })

  it('offers no button where passkeys cannot work', () => {
    // An old browser, or a page not on HTTPS. The password form is still there.
    renderWithPasskeys({}, ceremonyOf(), false)

    expect(screen.queryByRole('button', { name: 'Use a passkey' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Log in' })).toBeTruthy()
  })
})
