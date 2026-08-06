import type { Profile } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { ProfileApi } from './Profile.tsx'

import { apiError } from '../api/client.ts'
import { ViewerProvider } from '../viewer.tsx'
import { ProfilePage } from './Profile.tsx'

afterEach(cleanup)

const aProfile = (over: Partial<Profile> = {}): Profile => ({
  account_id: 'a-1',
  email: 'fredrik@example.org',
  name: 'Fredrik',
  contact: 'fredrik on discord',
  allergies_notes: 'peanuts',
  ...over,
})

// The burns half of the page has its own file; here it resolves to nothing so the
// details form is what these tests are looking at.
const stub = (over: Partial<ProfileApi> = {}, profile = aProfile()): ProfileApi => ({
  getMyProfile: () => Promise.resolve({ profile }),
  setMyAvatar: () => Promise.reject(new Error('setMyAvatar is not stubbed here')),
  removeMyAvatar: () => Promise.reject(new Error('removeMyAvatar is not stubbed here')),
  updateMyProfile: () => Promise.reject(new Error('updateMyProfile is not stubbed here')),
  getMyBurns: () => Promise.resolve({ coming: [], past: [] }),
  getEventOptions: () => Promise.reject(new Error('getEventOptions is not stubbed here')),
  joinEvent: () => Promise.reject(new Error('joinEvent is not stubbed here')),
  leaveEvent: () => Promise.reject(new Error('leaveEvent is not stubbed here')),
  updateMyStay: () => Promise.reject(new Error('updateMyStay is not stubbed here')),
  logout: () => Promise.reject(new Error('logout is not stubbed here')),
  // The toggle renders "not supported" without a browser push API, which happy-dom
  // has none of, so it never reaches these.
  getPushKey: () => Promise.reject(new Error('getPushKey is not stubbed here')),
  getMyNotificationSettings: () => Promise.resolve({ muted: [] }),
  updateMyNotificationSettings: () =>
    Promise.reject(new Error('updateMyNotificationSettings is not stubbed here')),
  subscribeToPush: () => Promise.reject(new Error('subscribeToPush is not stubbed here')),
  unsubscribeFromPush: () => Promise.reject(new Error('unsubscribeFromPush is not stubbed here')),
  // `PasskeysField` has its own file. It renders "this browser cannot use passkeys"
  // under happy-dom, which has no `navigator.credentials`, so only the list is read.
  getMyPasskeys: () => Promise.resolve({ passkeys: [] }),
  startPasskeyRegistration: () => Promise.reject(new Error('startPasskeyRegistration is not stubbed here')),
  addPasskey: () => Promise.reject(new Error('addPasskey is not stubbed here')),
  removePasskey: () => Promise.reject(new Error('removePasskey is not stubbed here')),
  startPasskeyLogin: () => Promise.reject(new Error('startPasskeyLogin is not stubbed here')),
  finishPasskeyLogin: () => Promise.reject(new Error('finishPasskeyLogin is not stubbed here')),
  ...over,
})

const renderPage = (
  api: ProfileApi,
  viewer: Viewer = {
    status: 'signed-in',
    account: { id: 'a-1', name: null, avatar: null, roles: ['member'] },
  },
) =>
  render(
    <ViewerProvider viewer={viewer}>
      <ProfilePage api={api} />
    </ViewerProvider>,
  )

const fill = (label: string, value: string) => {
  fireEvent.input(screen.getByLabelText(label, { exact: false }), { target: { value } })
}

describe('ProfilePage', () => {
  it('shows what is stored', async () => {
    renderPage(stub())

    expect(await screen.findByLabelText('Your name')).toHaveProperty('value', 'Fredrik')
    expect(screen.getByLabelText(/Allergies/)).toHaveProperty('value', 'peanuts')
  })

  it('starts empty rather than blank-crashing on an account never filled in', async () => {
    // The CLI bootstrap admin has no name or contact, and may hold the member
    // role too, so null is a state this page must render.
    renderPage(stub({}, aProfile({ name: null, contact: null, allergies_notes: null })))

    expect(await screen.findByLabelText('Your name')).toHaveProperty('value', '')
  })

  it('saves what was typed', async () => {
    const updateMyProfile = vi.fn(() => Promise.resolve({ profile: aProfile({ name: 'Fredrik L' }) }))
    renderPage(stub({ updateMyProfile }))

    await screen.findByLabelText('Your name')
    fill('Your name', '  Fredrik L  ')
    screen.getByRole('button', { name: 'Save' }).click()

    await waitFor(() =>
      expect(updateMyProfile).toHaveBeenCalledWith({
        name: 'Fredrik L',
        contact: 'fredrik on discord',
        allergies_notes: 'peanuts',
      }),
    )
    expect((await screen.findByRole('status')).textContent).toContain('Saved')
  })

  it('sends null rather than an empty string for cleared allergies', async () => {
    const updateMyProfile = vi.fn(() => Promise.resolve({ profile: aProfile() }))
    renderPage(stub({ updateMyProfile }))

    await screen.findByLabelText('Your name')
    fill('Allergies', '   ')
    screen.getByRole('button', { name: 'Save' }).click()

    await waitFor(() =>
      expect(updateMyProfile).toHaveBeenCalledWith(expect.objectContaining({ allergies_notes: null })),
    )
  })

  it('refuses to clear the name, which planning needs', async () => {
    const updateMyProfile = vi.fn(() => Promise.resolve({ profile: aProfile() }))
    renderPage(stub({ updateMyProfile }))

    await screen.findByLabelText('Your name')
    fill('Your name', '  ')
    screen.getByRole('button', { name: 'Save' }).click()

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(updateMyProfile).not.toHaveBeenCalled()
  })

  it('surfaces a failed save rather than claiming success', async () => {
    renderPage(stub({ updateMyProfile: () => Promise.reject(apiError(400, 'bad_request', 'Nope.')) }))

    await screen.findByLabelText('Your name')
    screen.getByRole('button', { name: 'Save' }).click()

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('says the email cannot be changed here, rather than offering a field that fails', async () => {
    renderPage(stub())

    expect(await screen.findByText(/not possible yet/)).toBeTruthy()
    expect(screen.queryByLabelText(/email/i)).toBeNull()
  })

  it('does not fetch for someone who is not a member', async () => {
    const getMyProfile = vi.fn(() => Promise.resolve({ profile: aProfile() }))
    renderPage(stub({ getMyProfile }), { status: 'signed-out' })

    expect(screen.getByText(/for members/)).toBeTruthy()
    expect(getMyProfile).not.toHaveBeenCalled()
  })

  it('surfaces a failure to load', async () => {
    renderPage(stub({ getMyProfile: () => Promise.reject(new Error('nope')) }))

    expect((await screen.findByRole('alert')).textContent).toContain('reload')
  })
})
