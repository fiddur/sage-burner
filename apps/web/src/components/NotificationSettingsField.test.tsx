import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { NotificationSettingsApi } from './NotificationSettingsField.tsx'

import { apiError } from '../api/client.ts'
import { NotificationSettingsField } from './NotificationSettingsField.tsx'

afterEach(cleanup)

const stub = (over: Partial<NotificationSettingsApi> = {}): NotificationSettingsApi => ({
  getMyNotificationSettings: () => Promise.resolve({ muted: [] }),
  updateMyNotificationSettings: () => Promise.resolve({ muted: [] }),
  ...over,
})

const MEAL = 'Put on or taken off a meal'

describe('what to be told about', () => {
  it('starts with every box ticked, which is what storing only the off ones means', async () => {
    render(<NotificationSettingsField api={stub()} />)

    const boxes = await screen.findAllByRole('checkbox')
    expect(boxes).toHaveLength(6)
    expect(boxes.every((box) => box instanceof HTMLInputElement && box.checked)).toBe(true)
  })

  it('unticks the ones already switched off', async () => {
    render(
      <NotificationSettingsField
        api={stub({ getMyNotificationSettings: () => Promise.resolve({ muted: ['meal_role'] }) })}
      />,
    )

    const box = await screen.findByLabelText(MEAL)
    expect(box instanceof HTMLInputElement && box.checked).toBe(false)
  })

  it('mutes a category by unticking it', async () => {
    const update = vi.fn(() => Promise.resolve({ muted: ['meal_role' as const] }))
    render(<NotificationSettingsField api={stub({ updateMyNotificationSettings: update })} />)

    fireEvent.click(await screen.findByLabelText(MEAL))

    await waitFor(() => expect(update).toHaveBeenCalledWith({ muted: ['meal_role'] }))
  })

  it('unmutes by ticking it back', async () => {
    const update = vi.fn(() => Promise.resolve({ muted: [] }))
    render(
      <NotificationSettingsField
        api={stub({
          getMyNotificationSettings: () => Promise.resolve({ muted: ['meal_role'] }),
          updateMyNotificationSettings: update,
        })}
      />,
    )

    fireEvent.click(await screen.findByLabelText(MEAL))

    await waitFor(() => expect(update).toHaveBeenCalledWith({ muted: [] }))
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
    const box = screen.getByLabelText(MEAL)
    expect(box instanceof HTMLInputElement && box.checked).toBe(true)
  })
})
