import type { Notification } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PushBrowser } from '../push.ts'
import type { Viewer } from '../viewer.tsx'
import type { NotificationsApi } from './Notifications.tsx'

import { apiError } from '../api/client.ts'
import { NUDGE_DISMISSED_KEY, NUDGE_LATER_KEY } from '../push.ts'
import { ViewerProvider } from '../viewer.tsx'
import { Notifications } from './Notifications.tsx'

afterEach(cleanup)

const ADA: Viewer = {
  status: 'signed-in',
  account: { id: 'a-1', name: 'Ada', avatar: null, roles: ['member'] },
}

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

const SEEN = '2026-08-06T11:00:00.000Z'

const TWO: Notification[] = [
  one({ id: 'n-1', body: 'You are on helper for Dinner' }),
  one({ id: 'n-2', body: 'Your place is paid for', category: 'payment', link: null }),
]

const stub = (over: Partial<NotificationsApi> = {}, held = TWO, unseen = held.length): NotificationsApi => ({
  getMyNotifications: () => Promise.resolve({ notifications: held, unseen }),
  markNotificationsSeen: () => Promise.resolve({ notifications: held, unseen: 0 }),
  deleteMyNotification: () => Promise.resolve({ notifications: held.slice(1), unseen: 0 }),
  getMyNotificationSettings: () =>
    Promise.resolve({ on: ['meal_role'], email: ['meal_role'], digest: 'daily' }),
  updateMyNotificationSettings: () =>
    Promise.resolve({ on: ['meal_role'], email: ['meal_role'], digest: 'daily' }),
  getPushKey: () => Promise.resolve({ public_key: 'BFakeKey_with-url-safe' }),
  subscribeToPush: () => Promise.resolve(undefined),
  unsubscribeFromPush: () => Promise.resolve(undefined),
  ...over,
})

const aSubscription = (endpoint = 'https://push.example/one') => ({
  endpoint,
  unsubscribe: () => Promise.resolve(true),
  toJSON: () => ({ endpoint, keys: { p256dh: 'a-public-key', auth: 'a-secret' } }),
})

const aBrowser = (subscribed: boolean, permission: NotificationPermission = 'default'): PushBrowser => ({
  permission: () => permission,
  requestPermission: () => Promise.resolve('granted'),
  register: () =>
    Promise.resolve({
      getSubscription: () => Promise.resolve(subscribed ? aSubscription() : null),
      subscribe: () => Promise.resolve(aSubscription()),
    }),
})

const renderPage = (api: NotificationsApi, viewer: Viewer = ADA, browser?: PushBrowser) =>
  render(
    <ViewerProvider viewer={viewer}>
      <Notifications api={api} browser={browser} />
    </ViewerProvider>,
  )

describe('what a row offers', () => {
  const menuOn = async (said: string) => {
    fireEvent.click(await screen.findByRole('button', { name: `What to do with “${said}”` }))
  }

  it('switches the category off on both channels at once', async () => {
    const update = vi.fn(() => Promise.resolve({ on: [], email: [], digest: 'daily' as const }))
    renderPage(
      stub({
        getMyNotificationSettings: () =>
          Promise.resolve({ on: ['meal_role', 'payment'], email: ['meal_role'], digest: 'daily' }),
        updateMyNotificationSettings: update,
      }),
    )

    await menuOn('You are on helper for Dinner')
    fireEvent.click(screen.getByRole('button', { name: /Stop telling me about this/ }))

    await waitFor(() => expect(update).toHaveBeenCalledWith({ on: ['payment'], email: [], digest: 'daily' }))
  })

  it('says which kind it is switching off, the row itself not saying', async () => {
    renderPage(stub())

    await menuOn('You are on helper for Dinner')

    expect(
      screen.getByRole('button', {
        name: 'Stop telling me about this (Put on or taken off a meal)',
      }),
    ).toBeTruthy()
  })

  it('removes the row, and it is gone from what the page reads back', async () => {
    let held = TWO
    const remove = vi.fn((id: string) => {
      held = held.filter((item) => item.id !== id)
      return Promise.resolve({ notifications: held, unseen: 0 })
    })
    renderPage(
      stub({
        getMyNotifications: () => Promise.resolve({ notifications: held, unseen: 0 }),
        deleteMyNotification: remove,
      }),
    )

    await menuOn('You are on helper for Dinner')
    fireEvent.click(screen.getByRole('button', { name: 'Remove this notification' }))

    await waitFor(() => expect(remove).toHaveBeenCalledWith('n-1'))
    await waitFor(() => expect(screen.queryByText('You are on helper for Dinner')).toBeNull())
    expect(screen.getByText('Your place is paid for')).toBeTruthy()
  })

  it('says so where the removal fails, rather than dropping the row anyway', async () => {
    renderPage(
      stub({
        deleteMyNotification: () => Promise.reject(apiError(500, 'internal_error', 'Nope.')),
      }),
    )

    await menuOn('You are on helper for Dinner')
    fireEvent.click(screen.getByRole('button', { name: 'Remove this notification' }))

    expect(await screen.findByText('Nope.')).toBeTruthy()
    expect(screen.getByText('You are on helper for Dinner')).toBeTruthy()
  })
})

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
    const markNotificationsSeen = vi.fn(() => Promise.resolve({ notifications: TWO, unseen: 0 }))
    renderPage(stub({ markNotificationsSeen }, TWO, 0))

    await screen.findByText('You are on helper for Dinner')

    expect(markNotificationsSeen).not.toHaveBeenCalled()
  })

  it('keeps the new ones marked new while they are being read', async () => {
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

  it('marks one that arrives while the page is open as new, and keeps it that way', async () => {
    const later = one({ id: 'n-9', body: 'Bea is coming.' })
    let asked = 0
    renderPage(
      stub({
        getMyNotifications: () => {
          asked += 1
          if (asked === 1) return Promise.resolve({ notifications: [], unseen: 0 })

          return Promise.resolve({
            notifications:
              asked === 2
                ? [later]
                : [{ ...later, seen_at: SEEN }, one({ id: 'n-10', body: 'Cai is coming.', seen_at: SEEN })],
            unseen: asked === 2 ? 1 : 0,
          })
        },
      }),
    )
    await screen.findByText('Nothing yet.')

    fireEvent(window, new Event('focus'))
    const line = await screen.findByText('Bea is coming.')
    expect(line.closest('li')?.className).toBe('is-new')

    fireEvent(window, new Event('focus'))

    await screen.findByText('Cai is coming.')
    expect(screen.getByText('Bea is coming.').closest('li')?.className).toBe('is-new')
  })

  it('is open to an account with no role, since it is told things too', async () => {
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

describe('the offer to turn push on, at the foot of the bell', () => {
  const OFFER = /Push notifications are off on this device/

  afterEach(() => {
    globalThis.localStorage.clear()
    globalThis.sessionStorage.clear()
  })

  it('asks whoever is reading this with push off here', async () => {
    renderPage(stub(), ADA, aBrowser(false))

    expect(await screen.findByText(OFFER)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeTruthy()
  })

  it('stays away where this browser already hears them', async () => {
    renderPage(stub(), ADA, aBrowser(true))

    await waitFor(() => expect(screen.getByText('You are on helper for Dinner')).toBeTruthy())
    await waitFor(() => expect(screen.queryByText(OFFER)).toBeNull())
  })

  it('stays away where the browser has already refused, the button having nothing to promise', async () => {
    renderPage(stub(), ADA, aBrowser(false, 'denied'))

    await screen.findByText('You are on helper for Dinner')
    expect(screen.queryByText(OFFER)).toBeNull()
  })

  it('stays away where the browser cannot do push at all', async () => {
    renderPage(stub(), ADA, undefined)

    await screen.findByText('You are on helper for Dinner')
    expect(screen.queryByText(OFFER)).toBeNull()
  })

  it('subscribes from the strip itself', async () => {
    const subscribeToPush = vi.fn<NotificationsApi['subscribeToPush']>(() => Promise.resolve(undefined))
    renderPage(stub({ subscribeToPush }), ADA, aBrowser(false))

    fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }))

    await waitFor(() => expect(subscribeToPush).toHaveBeenCalledTimes(1))
  })

  it('goes for this sitting when waved off, and is back the next one', async () => {
    renderPage(stub(), ADA, aBrowser(false))
    await screen.findByText(OFFER)

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))

    await waitFor(() => expect(screen.queryByText(OFFER)).toBeNull())
    expect(globalThis.sessionStorage.getItem(NUDGE_LATER_KEY)).toBe('yes')

    cleanup()
    globalThis.sessionStorage.clear()
    renderPage(stub(), ADA, aBrowser(false))

    expect(await screen.findByText(OFFER)).toBeTruthy()
  })

  it('stays away for the same sitting once waved off', async () => {
    globalThis.sessionStorage.setItem(NUDGE_LATER_KEY, 'yes')
    renderPage(stub(), ADA, aBrowser(false))

    await screen.findByText('You are on helper for Dinner')
    expect(screen.queryByText(OFFER)).toBeNull()
  })

  it('is silenced for good by the heavier refusal the other strip carries', async () => {
    globalThis.localStorage.setItem(NUDGE_DISMISSED_KEY, 'yes')
    renderPage(stub(), ADA, aBrowser(false))

    await screen.findByText('You are on helper for Dinner')
    expect(screen.queryByText(OFFER)).toBeNull()
  })
})
