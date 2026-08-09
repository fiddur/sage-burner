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
  introduction: null,
  ...over,
})

// The burns half of the page has its own file; here it resolves to nothing so the
// details form is what these tests are looking at.
const stub = (over: Partial<ProfileApi> = {}, profile = aProfile()): ProfileApi => ({
  getMyProfile: () => Promise.resolve({ profile }),
  getMyConnections: () => Promise.resolve({ connections: [] }),
  getMyImages: () => Promise.resolve({ images: [] }),
  removeMyImage: () => Promise.reject(new Error('removeMyImage is not stubbed here')),
  getMyIdentities: () => Promise.resolve({ identities: [] }),
  removeMyIdentity: () => Promise.reject(new Error('removeMyIdentity is not stubbed here')),
  addMyConnection: () => Promise.reject(new Error('addMyConnection is not stubbed here')),
  updateMyConnection: () => Promise.reject(new Error('updateMyConnection is not stubbed here')),
  removeMyConnection: () => Promise.reject(new Error('removeMyConnection is not stubbed here')),
  reorderMyConnections: () => Promise.reject(new Error('reorderMyConnections is not stubbed here')),
  getAllergyItems: () => Promise.resolve({ items: [] }),
  uploadImage: () => Promise.reject(new Error('uploadImage is not stubbed here')),
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

/**
 * The introduction's box, by its exact label.
 *
 * `fill`'s prefix match finds three: `MarkdownField` names its Write and Preview buttons
 * after the field, so "A little about you" is a substring of all of them.
 */
const introduction = () => screen.getByLabelText<HTMLTextAreaElement>('A little about you', { exact: true })

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
        introduction: null,
      }),
    )
    expect((await screen.findByRole('status')).textContent).toContain('Saved')
  })

  it('saves what somebody wrote about themselves', async () => {
    // #390. `MarkdownField`, so it takes a paste, a drop and a photograph from a phone the
    // moment it is passed an uploader — nothing here has to know about pictures.
    const updateMyProfile = vi.fn(() => Promise.resolve({ profile: aProfile() }))
    renderPage(stub({ updateMyProfile }))

    await screen.findByLabelText('Your name')
    fireEvent.input(introduction(), { target: { value: '  I make **fire**.  ' } })
    screen.getByRole('button', { name: 'Save' }).click()

    await waitFor(() =>
      expect(updateMyProfile).toHaveBeenCalledWith(
        expect.objectContaining({ introduction: 'I make **fire**.' }),
      ),
    )
  })

  it('sends null for one that was cleared, rather than an empty string', async () => {
    const updateMyProfile = vi.fn(() => Promise.resolve({ profile: aProfile() }))
    renderPage(stub({ updateMyProfile }, aProfile({ introduction: 'I make fire.' })))

    await waitFor(() => expect(introduction()).toHaveProperty('value', 'I make fire.'))
    fireEvent.input(introduction(), { target: { value: '   ' } })
    screen.getByRole('button', { name: 'Save' }).click()

    await waitFor(() =>
      expect(updateMyProfile).toHaveBeenCalledWith(expect.objectContaining({ introduction: null })),
    )
  })

  it('will not save while a picture is still going up', async () => {
    // A profile stored mid-upload keeps the placeholder for good, and the picture that
    // lands a moment later is written into a box that has already been saved (#379).
    renderPage(stub({}, aProfile({ introduction: 'look ![Uploading sauna.jpg…]()' })))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true))
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

describe('the page for an account organising without attending', () => {
  const ORGANISER: Viewer = {
    status: 'signed-in',
    account: { id: 'a-1', name: 'Fredrik', avatar: null, roles: ['admin'] },
  }

  it('lets an admin who is not a member in, so notifications are reachable at all', async () => {
    // The bug (#396): the page was `require="member"`, the push toggle had been taken off
    // the admin page, and application notifications go precisely to admins.
    renderPage(stub(), ORGANISER)

    expect(await screen.findByRole('heading', { level: 1, name: 'Your details' })).toBeTruthy()
    expect(screen.queryByText(/for members/)).toBeNull()
  })

  it('offers the whole account half, including what #390 invites them to write', async () => {
    // `getMyProfile` and `updateMyProfile` are `requireApproved` since #412: a name, a
    // picture and an introduction belong to the account rather than to a stay, and the
    // introduction's empty state on their own page actively asks for one.
    renderPage(stub(), ORGANISER)

    expect(await screen.findByLabelText('Your name')).toBeTruthy()
    expect(screen.getByLabelText('A little about you', { exact: true })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'How people can reach you' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy()
  })

  it('offers no burn to join, which is the half that is a stay', async () => {
    // `joinEvent` is `requireMember`, so the button would be one the API refuses.
    renderPage(stub(), ORGANISER)

    await screen.findByLabelText('Your name')
    expect(screen.queryByText(/no burn planned/)).toBeNull()
  })

  it('reads the profile, which the API now answers it', async () => {
    const getMyProfile = vi.fn(() => Promise.resolve({ profile: aProfile() }))
    renderPage(stub({ getMyProfile }), ORGANISER)

    await screen.findByLabelText('Your name')
    expect(getMyProfile).toHaveBeenCalled()
  })

  it('still shows the whole page to a member, which is the ordinary case', async () => {
    renderPage(stub())

    expect(await screen.findByLabelText('Your name')).toBeTruthy()
    expect(screen.getByText(/These follow you from burn to burn/)).toBeTruthy()
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
