import type { Notification } from '@sage-burner/shared'

import { cleanup, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BellApi } from './NotificationBell.tsx'

import { NotificationBell } from './NotificationBell.tsx'

afterEach(cleanup)

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
  ...over,
})

describe('the bell', () => {
  it('counts what is new, and says so where a screen reader hears it', async () => {
    render(
      <NotificationBell
        api={stub({ getMyNotifications: () => Promise.resolve({ notifications: [one()], unseen: 1 }) })}
      />,
    )

    expect(await screen.findByRole('button', { name: 'Notifications, 1 new' })).toBeTruthy()
  })

  it('says nothing about a count when there is none', async () => {
    render(<NotificationBell api={stub()} />)

    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeTruthy()
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
    ;(await screen.findByRole('button', { name: 'Notifications, 1 new' })).click()

    await waitFor(() => expect(markNotificationsSeen).toHaveBeenCalled())
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeTruthy()
  })

  it('leads to the page the thing happened on', async () => {
    render(
      <NotificationBell
        api={stub({ getMyNotifications: () => Promise.resolve({ notifications: [one()], unseen: 1 }) })}
      />,
    )
    ;(await screen.findByRole('button', { name: 'Notifications, 1 new' })).click()

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
    ;(await screen.findByRole('button', { name: 'Notifications, 1 new' })).click()

    expect(await screen.findByText('You are on helper for Dinner')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('keeps the list after it has gone grey', async () => {
    // What the bubble counts is what is new, not what is outstanding: a notification
    // is a thing that happened, not a task to tick off.
    render(
      <NotificationBell
        api={stub({
          getMyNotifications: () =>
            Promise.resolve({ notifications: [one({ seen_at: '2026-08-06T11:00:00.000Z' })], unseen: 0 }),
        })}
      />,
    )
    ;(await screen.findByRole('button', { name: 'Notifications' })).click()

    expect(await screen.findByText('You are on helper for Dinner')).toBeTruthy()
  })

  it('says nothing at all when the server cannot be reached', async () => {
    // A bell that cannot reach the server has nothing useful to say, and an error
    // where a count goes would be worse than the absence of one.
    render(<NotificationBell api={stub({ getMyNotifications: () => Promise.reject(new Error('nope')) })} />)

    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeTruthy()
  })
})
