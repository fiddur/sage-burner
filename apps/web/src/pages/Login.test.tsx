import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'

import { signingInOutcomes } from '@sage-burner/shared'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { LocationProvider } from 'preact-iso'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AppApi } from '../app.tsx'
import type { Ceremony, PasskeyApi } from '../passkey.ts'
import type { Viewer } from '../viewer.tsx'

import { apiError } from '../api/client.ts'
import { InstallationProvider } from '../installation.tsx'
import { ViewerProvider } from '../viewer.tsx'
import { landsOn, Login, signInOutcome } from './Login.tsx'

afterEach(cleanup)

const noPasskeys = (): PasskeyApi => ({
  startPasskeyRegistration: () => Promise.reject(new Error('startPasskeyRegistration is not stubbed here')),
  addPasskey: () => Promise.reject(new Error('addPasskey is not stubbed here')),
  startPasskeyLogin: () => Promise.reject(new Error('startPasskeyLogin is not stubbed here')),
  finishPasskeyLogin: () => Promise.reject(new Error('finishPasskeyLogin is not stubbed here')),
})

const renderLogin = (
  login: AppApi['login'],
  viewer: Viewer = { status: 'signed-out' },
  installation: { sendsEmail?: boolean; knowsOwnAddress?: boolean } = {},
) => {
  history.replaceState(null, '', '/login')

  return render(
    <LocationProvider>
      <InstallationProvider sendsEmail knowsOwnAddress {...installation}>
        <ViewerProvider viewer={viewer}>
          <Login api={{ login, ...noPasskeys() }} />
        </ViewerProvider>
      </InstallationProvider>
    </LocationProvider>,
  )
}

const fillIn = (email: string, password: string) => {
  fireEvent.input(screen.getByLabelText('Email'), { target: { value: email } })
  fireEvent.input(screen.getByLabelText('Password'), { target: { value: password } })
}

const submit = () => screen.getByRole('button', { name: 'Log in' }).click()

describe('what a provider round trip says when it comes back here', () => {
  it('has a sentence for every outcome that lands here, and says nothing about who exists', () => {
    for (const outcome of signingInOutcomes) {
      const message = signInOutcome(outcome)
      expect(message, outcome).toBeDefined()
      expect(message, outcome).not.toMatch(/exists|found|unknown|no such/i)
    }
  })

  it('has a sentence for a refusal, and none for an ordinary visit', () => {
    expect(signInOutcome('refused')).toContain('did not work')
    expect(signInOutcome(null)).toBeUndefined()
  })

  it('offers the password as the way in, which the details page cannot', () => {
    for (const outcome of ['misconfigured', 'unreachable', 'refused']) {
      expect(signInOutcome(outcome), outcome).toContain('with your password')
    }
  })

  it('tells somebody it is not set up here, with something for an organiser to search for', () => {
    const message = signInOutcome('misconfigured', 'req-8s')

    expect(message).toContain('not set up correctly here')
    expect(message).toContain('Mention req-8s.')
  })

  it('does not say the provider refused, since on one path it was never asked', () => {
    expect(signInOutcome('misconfigured')).not.toMatch(/refus|reject|declin/iu)
  })

  it('tells somebody to try again when nothing could be reached, and quotes nothing without a ref', () => {
    expect(signInOutcome('unreachable', 'req-8s')).toContain('Try again in a moment')
    expect(signInOutcome('unreachable', null)).not.toContain('Mention')
  })
})

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
    const login = vi.fn(() => Promise.reject(apiError(401, 'invalid_credentials', 'You need to sign in.')))
    renderLogin(login)

    fillIn('ada@example.org', 'wrong')
    submit()

    expect((await screen.findByRole('alert')).textContent).toBe('That email and password did not match.')
  })

  it('tells a rate-limited member to wait, rather than to try again', async () => {
    const login = vi.fn<AppApi['login']>(() =>
      Promise.reject(apiError(429, 'rate_limited', 'Too many attempts just now.')),
    )
    renderLogin(login)

    fillIn('ada@example.org', 'a good long passphrase')
    submit()

    const message = (await screen.findByRole('alert')).textContent
    expect(message).toContain('Wait a few seconds')
    expect(message).not.toBe('Could not sign in just now. Please try again.')
  })

  it('distinguishes a server failure from a rejected password', async () => {
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
    const login = vi.fn(() => Promise.resolve({ viewer: null }))
    renderLogin(login)

    fillIn('ada@example.org', 'a good long passphrase')
    submit()

    expect((await screen.findByRole('alert')).textContent).toContain('did not say who')
  })

  it('does not post an empty form, which would be answered as a wrong password', async () => {
    const login = vi.fn<AppApi['login']>(() => Promise.resolve({ viewer: null }))
    renderLogin(login)

    submit()

    expect(login).not.toHaveBeenCalled()
  })

  it('shows no form while the viewer is still loading', async () => {
    render(
      <ViewerProvider viewer={{ status: 'loading' }}>
        <Login api={{ login: vi.fn(() => Promise.resolve({ viewer: null })), ...noPasskeys() }} />
      </ViewerProvider>,
    )

    expect(screen.queryByLabelText('Email')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Log in' })).toBeNull()
  })

  it('offers the way to a forgotten password, and where to go with no account', async () => {
    renderLogin(vi.fn(() => Promise.resolve({ viewer: null })))

    expect((await screen.findByRole('link', { name: 'Forgotten your password?' })).getAttribute('href')).toBe(
      '/forgotten',
    )
    expect(screen.getByRole('link', { name: 'Apply to join' }).getAttribute('href')).toBe('/apply')
  })

  it('says why there is none where no mail server is set up, rather than offering a dead link', async () => {
    renderLogin(
      vi.fn(() => Promise.resolve({ viewer: null })),
      { status: 'signed-out' },
      { sendsEmail: false },
    )

    expect((await screen.findByText(/lost your password/)).textContent).toContain('ask someone with admin')
    expect(screen.queryByRole('link', { name: 'Forgotten your password?' })).toBeNull()
  })

  it('offers neither while the installation read is in flight, so nothing appears and vanishes', async () => {
    render(
      <LocationProvider>
        <InstallationProvider>
          <ViewerProvider viewer={{ status: 'signed-out' }}>
            <Login api={{ login: vi.fn(() => Promise.resolve({ viewer: null })), ...noPasskeys() }} />
          </ViewerProvider>
        </InstallationProvider>
      </LocationProvider>,
    )

    expect(await screen.findByRole('button', { name: 'Log in' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Forgotten your password?' })).toBeNull()
    expect(screen.queryByText(/lost your password/)).toBeNull()
  })

  it('offers none where the installation does not know its own address, no link being postable', async () => {
    renderLogin(
      vi.fn(() => Promise.resolve({ viewer: null })),
      { status: 'signed-out' },
      { knowsOwnAddress: false },
    )

    expect((await screen.findByText(/lost your password/)).textContent).toContain('ask someone with admin')
    expect(screen.queryByRole('link', { name: 'Forgotten your password?' })).toBeNull()
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
    renderWithPasskeys({}, ceremonyOf(), false)

    expect(screen.queryByRole('button', { name: 'Use a passkey' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Log in' })).toBeTruthy()
  })
})

describe('where signing in lands', () => {
  it('is the feed for a member, which is what they came for', () => {
    expect(landsOn(['member'])).toBe('/feed')
  })

  it('is the feed for an admin as well', () => {
    expect(landsOn(['admin'])).toBe('/feed')
  })

  it('is their own application for somebody with no role, who the feed would bounce', () => {
    expect(landsOn([])).toBe('/apply')
  })
})

describe('signing in navigates rather than offering a link', () => {
  const aMember = { account_id: 'a-1', name: null, avatar: null, roles: ['member' as const] }

  it('lands a member on the feed', async () => {
    renderLogin(() => Promise.resolve({ viewer: aMember }))

    fillIn('ada@example.org', 'a good long passphrase')
    submit()

    await waitFor(() => expect(location.pathname).toBe('/feed'))
  })

  it('lands somebody with no role on their own application', async () => {
    renderLogin(() => Promise.resolve({ viewer: { ...aMember, roles: [] } }))

    fillIn('ada@example.org', 'a good long passphrase')
    submit()

    await waitFor(() => expect(location.pathname).toBe('/apply'))
  })

  it('takes somebody already signed in off the login page, rather than stranding them', async () => {
    renderLogin(() => Promise.reject(new Error('login is not called here')), {
      status: 'signed-in',
      account: { id: 'a-1', name: 'Ada', avatar: null, roles: ['member'] },
    })

    await waitFor(() => expect(location.pathname).toBe('/feed'))
  })
})

describe('what Back does after signing in', () => {
  it('replaces the login page rather than stacking on it, so Back is not a loop', async () => {
    const before = history.length
    renderLogin(() =>
      Promise.resolve({ viewer: { account_id: 'a-1', name: null, avatar: null, roles: ['member'] } }),
    )

    fillIn('ada@example.org', 'a good long passphrase')
    submit()

    await waitFor(() => expect(location.pathname).toBe('/feed'))
    expect(history.length).toBe(before)
  })
})
