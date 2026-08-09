import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { OauthApi } from './OauthField.tsx'

import { OauthField } from './OauthField.tsx'

afterEach(cleanup)

const SAVED = {
  provider: 'facebook' as const,
  client_id: 'client-1',
  has_secret: true,
  updated_at: '2026-08-01T00:00:00.000Z',
}

const stub = (over: Partial<OauthApi> = {}): OauthApi => ({
  getOauthSettings: () => Promise.resolve({ settings: null }),
  updateOauthSettings: () => Promise.reject(new Error('updateOauthSettings is not stubbed here')),
  removeOauthSettings: () => Promise.reject(new Error('removeOauthSettings is not stubbed here')),
  ...over,
})

const show = (api: OauthApi) => render(<OauthField api={api} provider="facebook" />)

describe('setting a provider up', () => {
  it('says where the id comes from and what it costs before anybody starts', async () => {
    // Facebook's review is the thing worth knowing before filling this in, not after.
    show(stub())

    expect(await screen.findByText(/developers\.facebook\.com/)).toBeTruthy()
    expect(screen.getByText(/app review for public_profile/)).toBeTruthy()
  })

  it('says the button is absent until this is filled in', async () => {
    show(stub())

    expect(await screen.findByText(/the button does not appear anywhere/)).toBeTruthy()
  })

  it('shows the redirect URI to register, since the app builds it', async () => {
    // An admin pasting a different one into the console is the failure this prevents.
    show(stub())

    expect(await screen.findByText('/api/auth/oauth/facebook/callback')).toBeTruthy()
  })

  it('prints the privacy-policy URL app review asks for', async () => {
    // The other string an admin pastes into the Meta console, and the one #400 named three
    // times without ever producing a page for.
    show(stub())

    expect(await screen.findByText('/privacy')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'this page' }).getAttribute('href')).toBe('/privacy')
  })

  it('seeds the id from what is stored, and never the secret', async () => {
    show(stub({ getOauthSettings: () => Promise.resolve({ settings: SAVED }) }))

    const id = await screen.findByLabelText<HTMLInputElement>('Facebook client ID')
    const secret = screen.getByLabelText<HTMLInputElement>('Facebook client secret')

    expect(id.value).toBe('client-1')
    expect(secret.value).toBe('')
    expect(secret.placeholder).toContain('Stored')
  })

  it('omits the secret from a save that left the box alone', async () => {
    // Empty is a secret being cleared; typing nothing into a blank box is not that, and
    // treating them the same would wipe the secret on every unrelated edit.
    const updateOauthSettings = vi.fn(() => Promise.resolve({ settings: SAVED }))
    show(stub({ getOauthSettings: () => Promise.resolve({ settings: SAVED }), updateOauthSettings }))

    fireEvent.input(await screen.findByLabelText('Facebook client ID'), { target: { value: 'client-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateOauthSettings).toHaveBeenCalledWith('facebook', { client_id: 'client-2' }),
    )
  })

  it('sends the secret when one was typed', async () => {
    const updateOauthSettings = vi.fn(() => Promise.resolve({ settings: SAVED }))
    show(stub({ updateOauthSettings }))

    fireEvent.input(await screen.findByLabelText('Facebook client ID'), { target: { value: 'client-1' } })
    fireEvent.input(screen.getByLabelText('Facebook client secret'), { target: { value: 'hunter2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateOauthSettings).toHaveBeenCalledWith('facebook', {
        client_id: 'client-1',
        client_secret: 'hunter2',
      }),
    )
  })

  it('offers Remove only once something is stored', async () => {
    show(stub())
    await screen.findByLabelText('Facebook client ID')

    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()

    cleanup()
    show(stub({ getOauthSettings: () => Promise.resolve({ settings: SAVED }) }))

    expect(await screen.findByRole('button', { name: 'Remove' })).toBeTruthy()
  })

  it('empties the form when the provider is removed', async () => {
    const removeOauthSettings = vi.fn(() => Promise.resolve({ settings: null }))
    show(stub({ getOauthSettings: () => Promise.resolve({ settings: SAVED }), removeOauthSettings }))

    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(removeOauthSettings).toHaveBeenCalledWith('facebook'))
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('Facebook client ID').value).toBe(''))
  })

  it('says a save failed rather than looking as though it worked', async () => {
    show(stub({ updateOauthSettings: () => Promise.reject(new Error('nope')) }))

    fireEvent.input(await screen.findByLabelText('Facebook client ID'), { target: { value: 'client-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Could not save')
  })
})
