import { notificationCategories } from '@sage-burner/shared'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { NotificationSettingsApi } from './NotificationSettingsField.tsx'

import { apiError } from '../api/client.ts'
import { NotificationSettingsField } from './NotificationSettingsField.tsx'

afterEach(cleanup)

/** What the server sends an account that has never saved: the six on by default. */
const DEFAULTS = [
  'meal_role',
  'dream_role',
  'lead_role',
  'payment',
  'waiting_list_near',
  'waiting_list_pushed',
] as const

const stub = (over: Partial<NotificationSettingsApi> = {}): NotificationSettingsApi => ({
  getMyNotificationSettings: () => Promise.resolve({ on: [...DEFAULTS] }),
  updateMyNotificationSettings: () => Promise.resolve({ on: [...DEFAULTS] }),
  ...over,
})

const MEAL = 'Put on or taken off a meal'
const DREAM_OFFERED = 'Somebody offers a dream'

const checked = (label: string) => {
  const box = screen.getByLabelText(label)
  return box instanceof HTMLInputElement && box.checked
}

describe('what to be told about', () => {
  it('shows a row for every category, in two sections', async () => {
    render(<NotificationSettingsField api={stub()} />)

    const boxes = await screen.findAllByRole('checkbox')
    expect(boxes).toHaveLength(notificationCategories.length)
    expect(screen.getByText('What happens to you')).toBeTruthy()
    expect(screen.getByText('What else is going on')).toBeTruthy()
  })

  it('ticks what happens to you and leaves the rest alone', async () => {
    // The two halves default differently, which is the whole reason the wire carries
    // what is on rather than what is off (#259).
    render(<NotificationSettingsField api={stub()} />)

    await screen.findByLabelText(MEAL)
    expect(checked(MEAL)).toBe(true)
    expect(checked(DREAM_OFFERED)).toBe(false)
  })

  it('does not invent a default of its own when the read fails', async () => {
    // Nothing rather than everything: a table drawn with six ticks it did not get
    // from the server would switch six categories off the moment one was touched.
    render(
      <NotificationSettingsField
        api={stub({
          getMyNotificationSettings: () => Promise.reject(apiError(500, 'internal_error', 'Nope.')),
        })}
      />,
    )

    await screen.findByLabelText(MEAL)
    expect(checked(MEAL)).toBe(false)
  })

  it('switches one off by unticking it', async () => {
    const update = vi.fn(() => Promise.resolve({ on: [] }))
    render(<NotificationSettingsField api={stub({ updateMyNotificationSettings: update })} />)

    fireEvent.click(await screen.findByLabelText(MEAL))

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({
        on: DEFAULTS.filter((category) => category !== 'meal_role'),
      })
    })
  })

  it('switches one on by ticking it', async () => {
    // The passing sibling, and the case the old model could not express: this
    // category is off until somebody asks for it.
    const update = vi.fn(() => Promise.resolve({ on: [] }))
    render(<NotificationSettingsField api={stub({ updateMyNotificationSettings: update })} />)

    fireEvent.click(await screen.findByLabelText(DREAM_OFFERED))

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({ on: [...DEFAULTS, 'dream_offered'] })
    })
  })

  it('puts the box back when the save is refused', async () => {
    // A box showing a setting the server refused is worse than one that did not move.
    render(
      <NotificationSettingsField
        api={stub({
          updateMyNotificationSettings: () => Promise.reject(apiError(500, 'internal_error', 'Nope.')),
        })}
      />,
    )

    fireEvent.click(await screen.findByLabelText(MEAL))

    await screen.findByRole('alert')
    expect(checked(MEAL)).toBe(true)
  })
})
