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
  getMyNotificationSettings: () => Promise.resolve({ on: [...DEFAULTS], email: [] }),
  updateMyNotificationSettings: () => Promise.resolve({ on: [...DEFAULTS], email: [] }),
  ...over,
})

/** A row has a box per channel now, so a label names both (#30). */
const MEAL = 'Put on or taken off a meal — Here'
const MEAL_EMAIL = 'Put on or taken off a meal — Email'
const DREAM_OFFERED = 'Somebody offers a dream — Here'

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

  it('draws no table at all when the read fails', async () => {
    // Every save replaces the whole set, so an invented state is not a display bug —
    // it is committed. An empty table is the worst of them: the first tick would send
    // only that one and switch off the six this person never refused, losing payment
    // and waiting-list notices silently. Drawing the defaults instead would be wrong
    // for anybody who had saved settings. There is no state worth inventing.
    render(
      <NotificationSettingsField
        api={stub({
          getMyNotificationSettings: () => Promise.reject(apiError(500, 'internal_error', 'Nope.')),
        })}
      />,
    )

    await screen.findByRole('alert')
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('cannot save anything after a failed read', async () => {
    // The consequence, stated: with no boxes there is nothing to tick, so no save can
    // be built out of a state nobody supplied.
    let saves = 0
    render(
      <NotificationSettingsField
        api={stub({
          getMyNotificationSettings: () => Promise.reject(apiError(500, 'internal_error', 'Nope.')),
          updateMyNotificationSettings: () => {
            saves += 1
            return Promise.resolve({ on: [], email: [] })
          },
        })}
      />,
    )

    await screen.findByRole('alert')
    expect(screen.queryByLabelText(MEAL)).toBeNull()
    expect(saves).toBe(0)
  })

  it('switches one off by unticking it', async () => {
    const update = vi.fn(() => Promise.resolve({ on: [], email: [] }))
    render(<NotificationSettingsField api={stub({ updateMyNotificationSettings: update })} />)

    fireEvent.click(await screen.findByLabelText(MEAL))

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({
        on: DEFAULTS.filter((category) => category !== 'meal_role'),
        email: [],
      })
    })
  })

  it('switches one on by ticking it', async () => {
    // The passing sibling, and the case the old model could not express: this
    // category is off until somebody asks for it.
    const update = vi.fn(() => Promise.resolve({ on: [], email: [] }))
    render(<NotificationSettingsField api={stub({ updateMyNotificationSettings: update })} />)

    fireEvent.click(await screen.findByLabelText(DREAM_OFFERED))

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({ on: [...DEFAULTS, 'dream_offered'], email: [] })
    })
  })

  it('offers no email column where the installation has no mail server', async () => {
    // A switch that cannot do anything reads as a promise (#30).
    render(<NotificationSettingsField api={stub()} />)

    await screen.findByLabelText(MEAL)
    expect(screen.queryByLabelText(MEAL_EMAIL)).toBeNull()
    expect(screen.queryByText('Email')).toBeNull()
  })

  it('offers one where it has, off for every category', async () => {
    render(<NotificationSettingsField api={stub()} sendsEmail />)

    await screen.findByLabelText(MEAL_EMAIL)
    // Off even for the ones the bell has on: email is a channel of its own and is
    // never switched on by anything but asking.
    expect(checked(MEAL)).toBe(true)
    expect(checked(MEAL_EMAIL)).toBe(false)
  })

  it('sends both lists when one channel is ticked, leaving the other alone', async () => {
    const update = vi.fn(() => Promise.resolve({ on: [...DEFAULTS], email: ['meal_role' as const] }))
    render(<NotificationSettingsField api={stub({ updateMyNotificationSettings: update })} sendsEmail />)

    fireEvent.click(await screen.findByLabelText(MEAL_EMAIL))

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({ on: [...DEFAULTS], email: ['meal_role'] })
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
