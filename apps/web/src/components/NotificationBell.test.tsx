import type { Notification } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { LocationProvider, useLocation } from 'preact-iso'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BellApi } from './NotificationBell.tsx'

import { onADesktop, onAPhone } from '../testing/viewport.ts'
import { NotificationBell } from './NotificationBell.tsx'

afterEach(cleanup)
afterEach(onADesktop)
afterEach(() => history.replaceState(null, '', '/'))

const one = (over: Partial<Notification> = {}): Notification => ({
  id: 'n-1',
  category: 'meal_role',
  body: 'You are on helper for Dinner',
  link: '/meals',
  created_at: '2026-08-06T10:00:00.000Z',
  seen_at: null,
  ...over,
})

const stub = (over: Partial<BellApi> = {}): BellApi => ({
  getMyNotifications: () => Promise.resolve({ notifications: [], unseen: 0 }),
  markNotificationsSeen: () => Promise.resolve({ notifications: [], unseen: 0 }),
  deleteMyNotification: () => Promise.resolve({ notifications: [], unseen: 0 }),
  getMyNotificationSettings: () => Promise.resolve({ on: ['meal_role'], email: [], digest: 'daily' }),
  updateMyNotificationSettings: () => Promise.resolve({ on: [], email: [], digest: 'daily' }),
  ...over,
})

describe('the bell', () => {
  it('counts what is new, and says so where a screen reader hears it', async () => {
    render(
      <NotificationBell
        api={stub({ getMyNotifications: () => Promise.resolve({ notifications: [one()], unseen: 1 }) })}
      />,
    )

    expect(await screen.findByRole('link', { name: 'Notifications, 1 new' })).toBeTruthy()
  })

  it('is a bell somebody can see, rather than a mark that takes the page’s colour', async () => {
    render(<NotificationBell api={stub()} />)

    expect((await screen.findByRole('link', { name: 'Notifications' })).textContent).toBe('🔔')
  })

  it('says nothing about a count when there is none', async () => {
    render(<NotificationBell api={stub()} />)

    expect(await screen.findByRole('link', { name: 'Notifications' })).toBeTruthy()
  })

  it('leads to the page whatever the viewport', async () => {
    render(<NotificationBell api={stub()} />)

    expect((await screen.findByRole('link', { name: 'Notifications' })).getAttribute('href')).toBe(
      '/notifications',
    )
  })

  it('marks everything seen on opening, and drops the count', async () => {
    const markNotificationsSeen = vi.fn(() =>
      Promise.resolve({ notifications: [one({ seen_at: '2026-08-06T11:00:00.000Z' })], unseen: 0 }),
    )
    render(
      <NotificationBell
        api={stub({
          getMyNotifications: () => Promise.resolve({ notifications: [one()], unseen: 1 }),
          markNotificationsSeen,
        })}
      />,
    )

    fireEvent.click(await screen.findByRole('link', { name: 'Notifications, 1 new' }))

    await waitFor(() => expect(markNotificationsSeen).toHaveBeenCalled())
    expect(await screen.findByRole('link', { name: 'Notifications' })).toBeTruthy()
  })

  it('leads to the page the thing happened on', async () => {
    render(
      <NotificationBell
        api={stub({ getMyNotifications: () => Promise.resolve({ notifications: [one()], unseen: 1 }) })}
      />,
    )

    fireEvent.click(await screen.findByRole('link', { name: 'Notifications, 1 new' }))

    expect((await screen.findByRole('link', { name: /Dinner/ })).getAttribute('href')).toBe('/meals')
  })

  it('renders one with no page of its own as plain text', async () => {
    render(
      <NotificationBell
        api={stub({
          getMyNotifications: () => Promise.resolve({ notifications: [one({ link: null })], unseen: 1 }),
        })}
      />,
    )

    fireEvent.click(await screen.findByRole('link', { name: 'Notifications, 1 new' }))

    expect(await screen.findByText('You are on helper for Dinner')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Dinner/ })).toBeNull()
  })

  it('keeps the list after it has gone grey', async () => {
    render(
      <NotificationBell
        api={stub({
          getMyNotifications: () =>
            Promise.resolve({ notifications: [one({ seen_at: '2026-08-06T11:00:00.000Z' })], unseen: 0 }),
        })}
      />,
    )

    fireEvent.click(await screen.findByRole('link', { name: 'Notifications' }))

    expect(await screen.findByText('You are on helper for Dinner')).toBeTruthy()
  })

  const opened = async () => {
    render(
      <NotificationBell
        api={stub({
          getMyNotifications: () =>
            Promise.resolve({
              notifications: [one({ seen_at: '2026-08-06T11:00:00.000Z' })],
              unseen: 0,
            }),
        })}
      />,
    )
    fireEvent.click(await screen.findByRole('link', { name: 'Notifications' }))

    return await screen.findByText('You are on helper for Dinner')
  }

  it('puts itself away when something else on the page is pressed', async () => {
    await opened()

    fireEvent.pointerDown(document.body)

    await waitFor(() => expect(screen.queryByText('You are on helper for Dinner')).toBeNull())
  })

  it('stays open when the press lands inside it', async () => {
    fireEvent.pointerDown(await opened())

    expect(screen.queryByText('You are on helper for Dinner')).toBeTruthy()
  })

  it('closes on Escape and hands focus back to the bell', async () => {
    await opened()

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByText('You are on helper for Dinner')).toBeNull())
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Notifications' }))
  })

  it('ignores a key that is not Escape', async () => {
    await opened()

    fireEvent.keyDown(document, { key: 'Enter' })

    expect(screen.queryByText('You are on helper for Dinner')).toBeTruthy()
  })

  it('shuts only the row menu on Escape, the panel behind it staying open', async () => {
    await opened()

    const dots = screen.getByRole('button', { name: /^What to do with/u })
    fireEvent.click(dots)
    await screen.findByRole('button', { name: 'Remove this notification' })

    fireEvent.keyDown(dots, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove this notification' })).toBeNull())
    expect(screen.queryByText('You are on helper for Dinner')).toBeTruthy()
    expect(document.activeElement).toBe(dots)
  })

  it('says so when a category is switched off, there being nothing else to see', async () => {
    await opened()

    fireEvent.click(screen.getByRole('button', { name: /^What to do with/u }))
    fireEvent.click(await screen.findByRole('button', { name: /^Stop telling me about this/u }))

    expect((await screen.findByRole('status')).textContent).toContain('Put on or taken off a meal')
  })

  it('says nothing at all when the server cannot be reached', async () => {
    render(<NotificationBell api={stub({ getMyNotifications: () => Promise.reject(new Error('nope')) })} />)

    expect(await screen.findByRole('link', { name: 'Notifications' })).toBeTruthy()
  })

  describe('a click it does not intercept', () => {
    const withOne = async () => {
      render(
        <NotificationBell
          api={stub({
            getMyNotifications: () =>
              Promise.resolve({
                notifications: [one({ seen_at: '2026-08-06T11:00:00.000Z' })],
                unseen: 0,
              }),
          })}
        />,
      )

      return await screen.findByRole('link', { name: 'Notifications' })
    }

    it('opens no panel on a phone, because the page is the whole answer there', async () => {
      onAPhone()

      fireEvent.click(await withOne())

      expect(screen.queryByText('You are on helper for Dinner')).toBeNull()
    })

    it('leaves a modified click to the browser', async () => {
      fireEvent.click(await withOne(), { metaKey: true })

      expect(screen.queryByText('You are on helper for Dinner')).toBeNull()
    })

    const underTheRouter = async () => {
      const Where = () => <p data-testid="where">{useLocation().path}</p>

      render(
        <LocationProvider>
          <NotificationBell
            api={stub({
              getMyNotifications: () =>
                Promise.resolve({
                  notifications: [one({ seen_at: '2026-08-06T11:00:00.000Z' })],
                  unseen: 0,
                }),
            })}
          />
          <Where />
        </LocationProvider>,
      )

      return await screen.findByRole('link', { name: 'Notifications' })
    }

    it('opens the panel where it is a panel, and stays on the page it is on', async () => {
      fireEvent.click(await underTheRouter())

      expect(await screen.findByText('You are on helper for Dinner')).toBeTruthy()
      expect(screen.getByTestId('where').textContent).toBe('/')
    })

    it('lets the router have the click on a phone, which is the whole point of the href', async () => {
      onAPhone()

      fireEvent.click(await underTheRouter())

      await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/notifications'))
      expect(screen.queryByText('You are on helper for Dinner')).toBeNull()
    })

    it('says it expands only where it does', async () => {
      onAPhone()

      expect((await withOne()).hasAttribute('aria-expanded')).toBe(false)

      cleanup()
      onADesktop()

      expect((await withOne()).getAttribute('aria-expanded')).toBe('false')
    })
  })
})

describe('what the bell asks for while nobody is looking', () => {
  const hidden = (state: 'visible' | 'hidden') =>
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state)

  afterEach(() => vi.restoreAllMocks())

  it('stops polling a tab that is not on screen', async () => {
    vi.useFakeTimers()
    const ask = vi.fn(() => Promise.resolve({ notifications: [], unseen: 0 }))

    try {
      render(
        <LocationProvider>
          <NotificationBell api={stub({ getMyNotifications: ask })} />
        </LocationProvider>,
      )

      expect(ask).toHaveBeenCalledTimes(1)

      hidden('hidden')
      await vi.advanceTimersByTimeAsync(5 * 60_000)

      expect(ask).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('goes on polling one that is', async () => {
    vi.useFakeTimers()
    const ask = vi.fn(() => Promise.resolve({ notifications: [], unseen: 0 }))

    try {
      render(
        <LocationProvider>
          <NotificationBell api={stub({ getMyNotifications: ask })} />
        </LocationProvider>,
      )

      await vi.advanceTimersByTimeAsync(5 * 60_000)

      expect(ask.mock.calls.length).toBeGreaterThan(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('catches up the moment the tab is looked at again', async () => {
    const ask = vi.fn(() => Promise.resolve({ notifications: [], unseen: 0 }))
    render(
      <LocationProvider>
        <NotificationBell api={stub({ getMyNotifications: ask })} />
      </LocationProvider>,
    )

    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1))

    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))

    await waitFor(() => expect(ask).toHaveBeenCalledTimes(2))
  })

  it('catches up the moment somebody comes back to the tab', async () => {
    const ask = vi.fn(() => Promise.resolve({ notifications: [], unseen: 0 }))
    render(
      <LocationProvider>
        <NotificationBell api={stub({ getMyNotifications: ask })} />
      </LocationProvider>,
    )

    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1))

    globalThis.dispatchEvent(new Event('focus'))

    await waitFor(() => expect(ask).toHaveBeenCalledTimes(2))
  })
})
