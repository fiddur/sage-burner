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
  allergy_item_ids: [],
  ...over,
})

// The burns half of the page has its own file; here it resolves to nothing so the
// details form is what these tests are looking at.
const stub = (over: Partial<ProfileApi> = {}, profile = aProfile()): ProfileApi => ({
  getMyProfile: () => Promise.resolve({ profile }),
  getMyConnections: () => Promise.resolve({ connections: [] }),
  getMyIdentities: () => Promise.resolve({ identities: [] }),
  removeMyIdentity: () => Promise.reject(new Error('removeMyIdentity is not stubbed here')),
  addMyConnection: () => Promise.reject(new Error('addMyConnection is not stubbed here')),
  updateMyConnection: () => Promise.reject(new Error('updateMyConnection is not stubbed here')),
  removeMyConnection: () => Promise.reject(new Error('removeMyConnection is not stubbed here')),
  reorderMyConnections: () => Promise.reject(new Error('reorderMyConnections is not stubbed here')),
  getAllergyItems: () => Promise.resolve({ items: [] }),
  setMyAvatar: () => Promise.reject(new Error('setMyAvatar is not stubbed here')),
  removeMyAvatar: () => Promise.reject(new Error('removeMyAvatar is not stubbed here')),
  updateMyProfile: () => Promise.reject(new Error('updateMyProfile is not stubbed here')),
  getMyBurns: () => Promise.resolve({ coming: [], past: [] }),
  getEventOptions: () => Promise.reject(new Error('getEventOptions is not stubbed here')),
  joinEvent: () => Promise.reject(new Error('joinEvent is not stubbed here')),
  leaveEvent: () => Promise.reject(new Error('leaveEvent is not stubbed here')),
  getMembers: () => Promise.reject(new Error('getMembers is not stubbed here')),
  transferMyPlace: () => Promise.reject(new Error('transferMyPlace is not stubbed here')),
  updateMyStay: () => Promise.reject(new Error('updateMyStay is not stubbed here')),
  logout: () => Promise.reject(new Error('logout is not stubbed here')),
  // The toggle renders "not supported" without a browser push API, which happy-dom
  // has none of, so it never reaches these.
  getPushKey: () => Promise.reject(new Error('getPushKey is not stubbed here')),
  getMyNotificationSettings: () => Promise.resolve({ on: [], email: [] }),
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
        // Sent every time, because the form shows every box: a delta would need the
        // page to know what it had before in order to say what changed.
        allergy_item_ids: [],
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

describe('the allergy tick boxes', () => {
  const ITEMS = [
    { id: 'i-1', order: 0, label: 'Vegan' },
    { id: 'i-2', order: 1, label: 'Lactose' },
  ]

  const withItems = (over: Partial<ProfileApi> = {}) =>
    stub({ getAllergyItems: () => Promise.resolve({ items: ITEMS }), ...over })

  it('offers the list, ticked from what is stored', async () => {
    renderPage(
      withItems({
        getMyProfile: () => Promise.resolve({ profile: aProfile({ allergy_item_ids: ['i-2'] }) }),
      }),
    )

    expect(await screen.findByLabelText('Lactose')).toHaveProperty('checked', true)
    expect(screen.getByLabelText('Vegan')).toHaveProperty('checked', false)
  })

  it('sends what was ticked', async () => {
    const updateMyProfile = vi.fn(() => Promise.resolve({ profile: aProfile() }))
    renderPage(withItems({ updateMyProfile }))

    fireEvent.click(await screen.findByLabelText('Vegan'))
    screen.getByRole('button', { name: 'Save' }).click()

    await waitFor(() =>
      expect(updateMyProfile).toHaveBeenCalledWith(expect.objectContaining({ allergy_item_ids: ['i-1'] })),
    )
  })

  it('sends the set without one that was unticked', async () => {
    const updateMyProfile = vi.fn(() => Promise.resolve({ profile: aProfile() }))
    renderPage(
      withItems({
        updateMyProfile,
        getMyProfile: () => Promise.resolve({ profile: aProfile({ allergy_item_ids: ['i-1', 'i-2'] }) }),
      }),
    )

    fireEvent.click(await screen.findByLabelText('Vegan'))
    screen.getByRole('button', { name: 'Save' }).click()

    await waitFor(() =>
      expect(updateMyProfile).toHaveBeenCalledWith(expect.objectContaining({ allergy_item_ids: ['i-2'] })),
    )
  })

  it('keeps the free text as the Other beside them', async () => {
    // A vocabulary is never complete, and the cost of it being wrong here is
    // somebody's dinner.
    renderPage(withItems())

    expect(await screen.findByLabelText('Anything else you cannot eat')).toBeTruthy()
  })

  it('asks the old way when the list could not be fetched', async () => {
    // The passing sibling, and the reason the fetch has its own catch: the
    // vocabulary is a nicety beside the free text, and not having it must not cost
    // somebody the page their name is on.
    renderPage(stub({ getAllergyItems: () => Promise.reject(new Error('nope')) }))
    await screen.findByRole('button', { name: 'Save' })

    // Settled, not merely first-seen: `findBy` returns on the first match, so a
    // failure landing a microtask later would slip past it — which a mutation
    // turning this catch into `setLoaded({ status: 'failed' })` proved it did.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByLabelText('Allergies or food you cannot eat')).toBeTruthy()
    expect(screen.queryByLabelText('Vegan')).toBeNull()
  })
})
