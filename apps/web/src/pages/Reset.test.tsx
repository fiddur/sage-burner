import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { LocationProvider } from 'preact-iso'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { ResetApi } from './Reset.tsx'

import { apiError } from '../api/client.ts'
import { ViewerProvider } from '../viewer.tsx'
import { Reset } from './Reset.tsx'

afterEach(cleanup)

const TOKEN = 'a-token'

const renderPage = (api: Partial<ResetApi> = {}, viewer: Viewer = { status: 'signed-out' }) => {
  history.replaceState(null, '', `/reset/${TOKEN}`)

  return render(
    <LocationProvider>
      <ViewerProvider viewer={viewer}>
        <Reset
          token={TOKEN}
          api={{
            getPasswordResetState: () => Promise.resolve({ status: 'outstanding' }),
            resetPassword: () => Promise.reject(new Error('resetPassword is not stubbed here')),
            ...api,
          }}
        />
      </ViewerProvider>
    </LocationProvider>,
  )
}

const fillIn = async (password: string) => {
  fireEvent.input(await screen.findByLabelText('New password', { exact: false }), {
    target: { value: password },
  })
}

const setPassword = async (password: string) => {
  await fillIn(password)
  screen.getByRole('button', { name: 'Set it' }).click()
}

const submitPastTheField = () => {
  const form = document.querySelector('form')
  if (form === null) throw new Error('there is no form on the page')

  fireEvent.submit(form)
}

describe('setting a new password from a link', () => {
  it('sends the password with the token the link carried', async () => {
    const reset = vi.fn<ResetApi['resetPassword']>(() =>
      Promise.resolve({ viewer: { account_id: 'a-1', name: 'Ada', avatar: null, roles: ['member'] } }),
    )
    renderPage({ resetPassword: reset })

    await setPassword('a good long passphrase')

    await waitFor(() => {
      expect(reset).toHaveBeenCalledWith(TOKEN, { password: 'a good long passphrase' })
    })
  })

  it('lets the field itself stop a password too short to be one', async () => {
    const reset = vi.fn<ResetApi['resetPassword']>(() => Promise.reject(new Error('should not be reached')))
    renderPage({ resetPassword: reset })

    await setPassword('short')

    expect(screen.getByLabelText('New password', { exact: false })).toHaveProperty('validity.tooShort', true)
    expect(reset).not.toHaveBeenCalled()
  })

  it('says the floor itself for a submit the field did not stop', async () => {
    const reset = vi.fn<ResetApi['resetPassword']>(() => Promise.reject(new Error('should not be reached')))
    renderPage({ resetPassword: reset })

    await fillIn('short')
    submitPastTheField()

    expect((await screen.findByRole('alert')).textContent).toContain('at least 10 characters')
    expect(reset).not.toHaveBeenCalled()
  })

  it('says a run-out link has run out, and offers a fresh one', async () => {
    renderPage({ getPasswordResetState: () => Promise.resolve({ status: 'expired' }) })

    expect((await screen.findByRole('alert')).textContent).toContain('This link has run out')
    expect(screen.getByRole('link', { name: 'Ask for a fresh link' }).getAttribute('href')).toBe('/forgotten')
    expect(screen.queryByLabelText('New password', { exact: false })).toBeNull()
  })

  it('says a link it does not know is not one, rather than calling it expired', async () => {
    renderPage({ getPasswordResetState: () => Promise.resolve({ status: 'unknown' }) })

    expect((await screen.findByRole('alert')).textContent).toContain('do not recognise this link')
  })

  it('says the link is spent when the server refuses it, so the next step is a fresh one', async () => {
    renderPage({ resetPassword: () => Promise.reject(apiError(409, 'conflict', 'Conflict.')) })

    await setPassword('a good long passphrase')

    expect((await screen.findByRole('alert')).textContent).toContain('has been used already')
  })
})
