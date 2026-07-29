import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AppApi } from '../app.tsx'

import { apiError } from '../api/client.ts'
import { ViewerProvider } from '../viewer.tsx'
import { Login } from './Login.tsx'

/**
 * The login form against an injected client, so the assertions are about what a
 * member sees rather than about fetch being called.
 */

afterEach(cleanup)

const renderLogin = (login: AppApi['login']) =>
  render(
    <ViewerProvider viewer={{ status: 'signed-out' }}>
      <Login api={{ login }} />
    </ViewerProvider>,
  )

const fillIn = (email: string, password: string) => {
  fireEvent.input(screen.getByLabelText('Email'), { target: { value: email } })
  fireEvent.input(screen.getByLabelText('Password'), { target: { value: password } })
}

const submit = () => screen.getByRole('button', { name: 'Log in' }).click()

describe('Login', () => {
  it('sends what was typed', async () => {
    const login = vi.fn(() => Promise.resolve({ viewer: { account_id: 'a-1', roles: [] } }))
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
    const login = vi.fn(() => Promise.resolve({ viewer: { account_id: 'a-1', roles: ['member' as const] } }))
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

  it('says why there is no sign-up or password reset', async () => {
    // Both are absent by design — accounts come from invites (#17) and there is
    // no mail service (#30). A dead link would be worse than saying so.
    renderLogin(vi.fn(() => Promise.resolve({ viewer: null })))

    const note = await screen.findByText(/Accounts are created by invitation/)
    expect(note.textContent).toContain('ask an organiser')
  })
})
