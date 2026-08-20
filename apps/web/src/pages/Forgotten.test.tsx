import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { LocationProvider } from 'preact-iso'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ForgottenApi } from './Forgotten.tsx'

import { apiError } from '../api/client.ts'
import { InstallationProvider } from '../installation.tsx'
import { Forgotten } from './Forgotten.tsx'

afterEach(cleanup)

interface Installation {
  sendsEmail?: boolean
  knowsOwnAddress?: boolean
}

const renderPage = (api: Partial<ForgottenApi> = {}, installation: Installation = {}) => {
  history.replaceState(null, '', '/forgotten')

  return render(
    <LocationProvider>
      <InstallationProvider sendsEmail knowsOwnAddress {...installation}>
        <Forgotten
          api={{
            requestPasswordReset: () => Promise.reject(new Error('requestPasswordReset is not stubbed here')),
            ...api,
          }}
        />
      </InstallationProvider>
    </LocationProvider>,
  )
}

const askFor = (email: string) => {
  fireEvent.input(screen.getByLabelText('Email'), { target: { value: email } })
  screen.getByRole('button', { name: 'Send me a link' }).click()
}

describe('asking for a link to a new password', () => {
  it('sends the address to the route that posts one', async () => {
    const ask = vi.fn<ForgottenApi['requestPasswordReset']>(() => Promise.resolve())
    renderPage({ requestPasswordReset: ask })

    askFor('ada@example.org')

    await screen.findByText('Have a look in your inbox')
    expect(ask).toHaveBeenCalledWith({ email: 'ada@example.org' })
  })

  it('says a link is on its way without saying whether that address has an account', async () => {
    renderPage({ requestPasswordReset: () => Promise.resolve() })

    askFor('nobody@example.org')

    expect((await screen.findByRole('status')).textContent).toContain('If there is an account for')
  })

  it('says how long the link lasts, an expired one explaining nothing itself', async () => {
    renderPage({ requestPasswordReset: () => Promise.resolve() })

    askFor('ada@example.org')

    expect((await screen.findByRole('status')).textContent).toContain('for the next 2 hours')
  })

  it('asks for nothing where the installation has no mail server', () => {
    const ask = vi.fn<ForgottenApi['requestPasswordReset']>(() => Promise.resolve())
    renderPage({ requestPasswordReset: ask }, { sendsEmail: false })

    expect(screen.queryByLabelText('Email')).toBeNull()
    expect(screen.getByText(/cannot post you a link/)).toBeTruthy()
    expect(ask).not.toHaveBeenCalled()
  })

  it('asks for nothing where the installation does not know its own address either', () => {
    const ask = vi.fn<ForgottenApi['requestPasswordReset']>(() => Promise.resolve())
    renderPage({ requestPasswordReset: ask }, { knowsOwnAddress: false })

    expect(screen.queryByLabelText('Email')).toBeNull()
    expect(ask).not.toHaveBeenCalled()
  })

  it('asks nothing while the installation read is in flight', () => {
    render(
      <LocationProvider>
        <InstallationProvider>
          <Forgotten api={{ requestPasswordReset: () => Promise.resolve() }} />
        </InstallationProvider>
      </LocationProvider>,
    )

    expect(screen.queryByLabelText('Email')).toBeNull()
    expect(screen.queryByText(/cannot post you a link/)).toBeNull()
  })

  it('falls back to ask-an-organiser when the installation cannot be read at all', () => {
    render(
      <LocationProvider>
        <InstallationProvider unreachable>
          <Forgotten api={{ requestPasswordReset: () => Promise.resolve() }} />
        </InstallationProvider>
      </LocationProvider>,
    )

    expect(screen.getByText(/cannot post you a link/)).toBeTruthy()
    expect(screen.queryByText('One moment…')).toBeNull()
  })

  it('says how long to wait when it has been asked too often', async () => {
    renderPage({ requestPasswordReset: () => Promise.reject(apiError(429, 'rate_limited', 'Too many.')) })

    askFor('ada@example.org')

    expect((await screen.findByRole('alert')).textContent).toContain('Too many.')
    expect(screen.queryByText('Have a look in your inbox')).toBeNull()
  })
})
