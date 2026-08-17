import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { OauthApi } from './OauthField.tsx'

import { InstallationProvider, useSocialLogins } from '../installation.tsx'
import { OauthField } from './OauthField.tsx'

afterEach(cleanup)

const SAVED = {
  provider: 'facebook' as const,
  client_id: 'client-1',
  has_secret: true,
  ask_profile_link: false,
  updated_at: '2026-08-01T00:00:00.000Z',
}

const stub = (over: Partial<OauthApi> = {}): OauthApi => ({
  getOauthSettings: () => Promise.resolve({ settings: null }),
  updateOauthSettings: () => Promise.reject(new Error('updateOauthSettings is not stubbed here')),
  removeOauthSettings: () => Promise.reject(new Error('removeOauthSettings is not stubbed here')),
  ...over,
})

const show = (api: OauthApi) => render(<OauthField api={api} provider="facebook" />)

const Elsewhere = () => <span data-testid="elsewhere">{useSocialLogins().join(',')}</span>

const showWithSiblings = (api: OauthApi, socialLogins: readonly ('discord' | 'facebook')[] = []) =>
  render(
    <InstallationProvider socialLogins={socialLogins}>
      <OauthField api={api} provider="facebook" />
      <Elsewhere />
    </InstallationProvider>,
  )

describe('setting a provider up', () => {
  it('says where the id comes from and what it costs before anybody starts', async () => {
    show(stub())

    expect(await screen.findByText(/developers\.facebook\.com/)).toBeTruthy()
    expect(screen.getByText(/app review for public_profile/)).toBeTruthy()
  })

  it('says the button is absent until this is filled in', async () => {
    show(stub())

    expect(await screen.findByText(/the button does not appear anywhere/)).toBeTruthy()
  })

  it('shows the redirect URI to register, since the app builds it', async () => {
    show(stub())

    expect(await screen.findByText('/api/auth/oauth/facebook/callback')).toBeTruthy()
  })

  it('prints every URL Basic Settings asks for, so none is retyped', async () => {
    show(stub())

    const linkIn = (row: RegExp) => within(screen.getByText(row)).getByRole('link').getAttribute('href')

    expect(linkIn(/Privacy Policy/)).toBe('/privacy')
    expect(linkIn(/Terms of Service/)).toBe('/terms')
    expect(linkIn(/Data Deletion Instructions/)).toBe('/privacy')
  })

  it('tells the admin what their members will be asked to allow', async () => {
    const { container } = show(stub())
    await screen.findByLabelText('Facebook client ID')

    expect(container.textContent).toContain('asked to allow')
    expect(container.textContent).toContain('eight fields public_profile covers')
  })

  it('uses Discord’s own wording for Discord', async () => {
    const { container } = render(<OauthField api={stub()} provider="discord" />)
    await screen.findByLabelText('Discord client ID')

    expect(container.textContent).toContain('username, avatar and banner')
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
    const updateOauthSettings = vi.fn(() => Promise.resolve({ settings: SAVED }))
    show(stub({ getOauthSettings: () => Promise.resolve({ settings: SAVED }), updateOauthSettings }))

    fireEvent.input(await screen.findByLabelText('Facebook client ID'), { target: { value: 'client-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateOauthSettings).toHaveBeenCalledWith('facebook', {
        client_id: 'client-2',
        ask_profile_link: false,
      }),
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
        ask_profile_link: false,
        client_secret: 'hunter2',
      }),
    )
  })

  it('sends the profile-link permission once an admin says it is approved', async () => {
    const updateOauthSettings = vi.fn(() => Promise.resolve({ settings: SAVED }))
    show(stub({ updateOauthSettings }))

    fireEvent.input(await screen.findByLabelText('Facebook client ID'), { target: { value: 'client-1' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /user_link/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateOauthSettings).toHaveBeenCalledWith('facebook', {
        client_id: 'client-1',
        ask_profile_link: true,
      }),
    )
  })

  it('seeds the box from what is stored, so a save does not turn it back off', async () => {
    show(
      stub({
        getOauthSettings: () => Promise.resolve({ settings: { ...SAVED, ask_profile_link: true } }),
      }),
    )

    expect(await screen.findByRole<HTMLInputElement>('checkbox', { name: /user_link/ })).toHaveProperty(
      'checked',
      true,
    )
  })

  it('puts the provider in front of the other pages without a reload', async () => {
    const updateOauthSettings = vi.fn(() => Promise.resolve({ settings: SAVED }))
    showWithSiblings(stub({ updateOauthSettings }))

    expect((await screen.findByTestId('elsewhere')).textContent).toBe('')

    fireEvent.input(screen.getByLabelText('Facebook client ID'), { target: { value: 'client-1' } })
    fireEvent.input(screen.getByLabelText('Facebook client secret'), { target: { value: 'hunter2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByTestId('elsewhere').textContent).toBe('facebook'))
  })

  it('leaves the other provider where it was', async () => {
    const updateOauthSettings = vi.fn(() => Promise.resolve({ settings: SAVED }))
    showWithSiblings(stub({ updateOauthSettings }), ['discord'])

    fireEvent.input(await screen.findByLabelText('Facebook client ID'), { target: { value: 'c' } })
    fireEvent.input(screen.getByLabelText('Facebook client secret'), { target: { value: 'hunter2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByTestId('elsewhere').textContent).toBe('discord,facebook'))
  })

  it('takes it away again when the provider is removed', async () => {
    const removeOauthSettings = vi.fn(() => Promise.resolve({ settings: null }))
    showWithSiblings(
      stub({ getOauthSettings: () => Promise.resolve({ settings: SAVED }), removeOauthSettings }),
      ['discord', 'facebook'],
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    fireEvent.click(screen.getByRole('button', { name: /^Really /u }))

    await waitFor(() => expect(screen.getByTestId('elsewhere').textContent).toBe('discord'))
  })

  it('draws no link for a client id saved without a secret', async () => {
    const updateOauthSettings = vi.fn(() => Promise.resolve({ settings: { ...SAVED, has_secret: false } }))
    showWithSiblings(stub({ updateOauthSettings }))

    fireEvent.input(await screen.findByLabelText('Facebook client ID'), { target: { value: 'c' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateOauthSettings).toHaveBeenCalled())
    expect(screen.getByTestId('elsewhere').textContent).toBe('')
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
    fireEvent.click(screen.getByRole('button', { name: /^Really /u }))

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
