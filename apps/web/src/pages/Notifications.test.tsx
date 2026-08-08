import type { Notification } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { NotificationsApi } from './Notifications.tsx'

import { ViewerProvider } from '../viewer.tsx'
import { Notifications } from './Notifications.tsx'

afterEach(cleanup)

const ADA: Viewer = {
  status: 'signed-in',
  account: { id: 'a-1', name: 'Ada', avatar: null, roles: ['member'] },
}

/** An account with no role yet: somebody waiting on their application. */
const APPLICANT: Viewer = {
  status: 'signed-in',
  account: { id: 'a-2', name: 'Bea', avatar: null, roles: [] },
}

const one = (over: Partial<Notification> & Pick<Notification, 'id' | 'body'>): Notification => ({
  category: 'meal_role',
  link: '/meals',
  created_at: '2026-08-06T10:00:00.000Z',
  seen_at: null,
  ...over,
})

const TWO: Notification[] = [
  one({ id: 'n-1', body: 'You are on helper for Dinner' }),
  one({ id: 'n-2', body: 'Your place is paid for', category: 'payment', link: null }),
]

const stub = (over: Partial<NotificationsApi> = {}, held = TWO, unseen = held.length): NotificationsApi => ({
  getMyNotifications: () => Promise.resolve({ notifications: held, unseen }),
  markNotificationsSeen: () => Promise.resolve({ notifications: held, unseen: 0 }),
  ...over,
})

const renderPage = (api: NotificationsApi, viewer: Viewer = ADA) =>
  render(
    <ViewerProvider viewer={viewer}>
      <Notifications api={api} />
    </ViewerProvider>,
  )

describe('what has happened to you', () => {
  it('lists them in the order the server sent them', async () => {
    renderPage(stub())

    expect(await screen.findByText('You are on helper for Dinner')).toBeTruthy()
    expect(screen.getByText('Your place is paid for')).toBeTruthy()
  })

  it('leads to the page the thing happened on, and leaves one with none as text', async () => {
    renderPage(stub())

    expect((await screen.findByRole('link', { name: /Dinner/ })).getAttribute('href')).toBe('/meals')
    expect(screen.queryByRole('link', { name: /paid for/ })).toBeNull()
  })

  it('marks everything seen, which is what reading it means', async () => {
    const markNotificationsSeen = vi.fn(() => Promise.resolve({ notifications: TWO, unseen: 0 }))
    renderPage(stub({ markNotificationsSeen }))

    await screen.findByText('You are on helper for Dinner')

    await waitFor(() => expect(markNotificationsSeen).toHaveBeenCalled())
  })

  it('does not mark when there was nothing new', async () => {
    // A write for no change on every visit to a page somebody may keep open.
    const markNotificationsSeen = vi.fn(() => Promise.resolve({ notifications: TWO, unseen: 0 }))
    renderPage(stub({ markNotificationsSeen }, TWO, 0))

    await screen.findByText('You are on helper for Dinner')

    expect(markNotificationsSeen).not.toHaveBeenCalled()
  })

  it('keeps the new ones marked new while they are being read', async () => {
    // Marking is for the next visit. Replacing the list with the reply — which has
    // them all seen — would take the emphasis away in front of whoever came to look
    // at it, which is the one thing the page is for.
    renderPage(
      stub({
        markNotificationsSeen: () =>
          Promise.resolve({
            notifications: TWO.map((item) => ({ ...item, seen_at: '2026-08-06T11:00:00.000Z' })),
            unseen: 0,
          }),
      }),
    )

    const line = await screen.findByText('You are on helper for Dinner')

    await waitFor(() => expect(line.closest('li')?.className).toBe('is-new'))
  })

  it('keeps it through the refetch that comes back with them all seen', async () => {
    // The half the test above cannot show, and the one `live: true` broke: every
    // refetch after the page has marked them answers with `seen_at` set, so without
    // remembering what arrived new the bold vanished a minute in.
    const seen = TWO.map((item) => ({ ...item, seen_at: '2026-08-06T11:00:00.000Z' }))
    let asked = 0
    renderPage(
      stub({
        getMyNotifications: () => {
          asked += 1
          return Promise.resolve({ notifications: asked === 1 ? TWO : seen, unseen: asked === 1 ? 2 : 0 })
        },
      }),
    )
    const line = await screen.findByText('You are on helper for Dinner')

    fireEvent(window, new Event('focus'))

    await waitFor(() => expect(asked).toBeGreaterThan(1))
    expect(line.closest('li')?.className).toBe('is-new')
  })

  it('marks one that arrives while the page is open as new', async () => {
    // The set is only ever seeded from the first answer, so a later arrival is judged
    // on its own `seen_at` rather than being read as old for not having been there.
    let asked = 0
    renderPage(
      stub({
        getMyNotifications: () => {
          asked += 1
          return asked === 1
            ? Promise.resolve({ notifications: [], unseen: 0 })
            : Promise.resolve({ notifications: [one({ id: 'n-9', body: 'Bea is coming.' })], unseen: 1 })
        },
      }),
    )
    await screen.findByText('Nothing yet.')

    fireEvent(window, new Event('focus'))

    const line = await screen.findByText('Bea is coming.')
    expect(line.closest('li')?.className).toBe('is-new')
  })

  it('is open to an account with no role, since it is told things too', async () => {
    // An applicant hears when their application is decided. Telling them the page
    // announcing it is for members would be the app refusing to show somebody a
    // message it sent them.
    renderPage(
      stub({}, [one({ id: 'n-3', body: 'You are in.', category: 'application', link: null })]),
      APPLICANT,
    )

    expect(await screen.findByText('You are in.')).toBeTruthy()
  })

  it('offers the switches to a member, and not to somebody with no page to hold them', async () => {
    renderPage(stub())
    expect(await screen.findByRole('link', { name: 'your details' })).toBeTruthy()

    cleanup()
    renderPage(stub(), APPLICANT)
    await screen.findByText('You are on helper for Dinner')

    expect(screen.queryByRole('link', { name: 'your details' })).toBeNull()
  })

  it('catches up when the tab comes back, rather than going stale beside a counting bell', async () => {
    let asked = 0
    const getMyNotifications = vi.fn(() => {
      asked += 1
      return Promise.resolve({
        notifications: asked === 1 ? TWO : [...TWO, one({ id: 'n-3', body: 'Bea is coming.' })],
        unseen: 0,
      })
    })
    renderPage(stub({ getMyNotifications }, TWO, 0))
    await screen.findByText('You are on helper for Dinner')

    fireEvent(window, new Event('focus'))

    expect(await screen.findByText('Bea is coming.')).toBeTruthy()
  })

  it('says so when nothing has happened yet', async () => {
    renderPage(stub({}, [], 0))

    expect(await screen.findByText('Nothing yet.')).toBeTruthy()
  })

  it('says so when it could not ask', async () => {
    renderPage(stub({ getMyNotifications: () => Promise.reject(new Error('offline')) }))

    expect(await screen.findByText(/Could not load what has happened/)).toBeTruthy()
  })

  it('sends a signed-out visitor to log in rather than asking at all', async () => {
    const getMyNotifications = vi.fn(() => Promise.resolve({ notifications: [], unseen: 0 }))
    renderPage(stub({ getMyNotifications }), { status: 'signed-out' })

    expect(await screen.findByRole('link', { name: 'Log in' })).toBeTruthy()
    expect(getMyNotifications).not.toHaveBeenCalled()
  })
})
