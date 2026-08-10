import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { OauthApi } from './OauthField.tsx'

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

  it('prints every URL Basic Settings asks for, so none is retyped', async () => {
    // The strings an admin pastes into the Meta console beside the redirect URI. #400 named the
    // privacy one three times without producing a page for it; #419 added the other two, and the
    // deletion instructions are the privacy page again rather than a callback.
    show(stub())

    // Each row's own link rather than a count across the page: counting made this fail when an
    // unrelated `/privacy` link was added elsewhere in the field, which says nothing about
    // whether the three rows an admin pastes from are right.
    const linkIn = (row: RegExp) => within(screen.getByText(row)).getByRole('link').getAttribute('href')

    expect(linkIn(/Privacy Policy/)).toBe('/privacy')
    expect(linkIn(/Terms of Service/)).toBe('/terms')
    // The policy again: the deletion instructions are that page, not a callback.
    expect(linkIn(/Data Deletion Instructions/)).toBe('/privacy')
  })

  it('tells the admin what their members will be asked to allow', async () => {
    // #429: the consent screen names more than this app keeps, and an admin who has not seen it
    // cannot answer a member who has. Asserted on the container's text because the sentence is
    // built from an interpolation and a link, so no single element holds it.
    const { container } = show(stub())
    await screen.findByLabelText('Facebook client ID')

    expect(container.textContent).toContain('asked to allow')
    expect(container.textContent).toContain('eight fields public_profile covers')
  })

  it('uses Discord’s own wording for Discord', async () => {
    // The two differ, and the point is that it matches what the member is actually shown —
    // Discord's screen says exactly this, which is what prompted #429.
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
    // Empty is a secret being cleared; typing nothing into a blank box is not that, and
    // treating them the same would wipe the secret on every unrelated edit.
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
    // The failure this prevents: correcting a typo in the client id, with the box redrawn
    // unticked, would send `false` and stop asking for the permission on every later sign-in.
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
