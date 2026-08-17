import type { NotificationSettings } from '@sage-burner/shared'

import { categoriesAbout, notificationCategories, notificationCategoryInfo } from '@sage-burner/shared'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { NotificationSettingsApi } from './NotificationSettingsField.tsx'

import { apiError } from '../api/client.ts'
import { ViewerProvider } from '../viewer.tsx'
import { NotificationSettingsField } from './NotificationSettingsField.tsx'

afterEach(cleanup)

const DEFAULTS = [
  'meal_role',
  'dream_role',
  'lead_role',
  'payment',
  'waiting_list_near',
  'waiting_list_pushed',
  'application',
] as const

const asAdmin = (api: NotificationSettingsApi) => (
  <ViewerProvider
    viewer={{ status: 'signed-in', account: { id: 'a1', name: 'Ada', avatar: null, roles: ['admin'] } }}
  >
    <NotificationSettingsField api={api} />
  </ViewerProvider>
)

const stub = (over: Partial<NotificationSettingsApi> = {}): NotificationSettingsApi => ({
  getMyNotificationSettings: () => Promise.resolve({ on: [...DEFAULTS], email: [], digest: 'daily' }),
  updateMyNotificationSettings: () => Promise.resolve({ on: [...DEFAULTS], email: [], digest: 'daily' }),
  ...over,
})

const MEAL = 'Put on or taken off a meal — Here'
const MEAL_EMAIL = 'Put on or taken off a meal — Email'
const DREAM_OFFERED = 'Somebody offers a dream — Here'

const checked = (label: string) => {
  const box = screen.getByLabelText(label)
  return box instanceof HTMLInputElement && box.checked
}

const mixed = (label: string) => {
  const box = screen.getByLabelText(label)
  return box instanceof HTMLInputElement && box.indeterminate
}

const open = async (heading: string) => {
  fireEvent.click(await screen.findByRole('button', { name: heading }))
}

describe('what to be told about', () => {
  it('starts collapsed, with one switch per section rather than one per category', async () => {
    render(<NotificationSettingsField api={stub()} />)

    expect(await screen.findAllByRole('checkbox')).toHaveLength(3)
    expect(screen.getByText('What happens to you')).toBeTruthy()
    expect(screen.getByText('What others are doing')).toBeTruthy()
    expect(screen.getByText('A new version of the app is out')).toBeTruthy()
    expect(screen.queryByText('What you look after')).toBeNull()
  })

  it('has a switch for every category a member is ever told about, once the sections are open', async () => {
    render(<NotificationSettingsField api={stub()} />)

    await open('What happens to you')
    await open('What others are doing')

    for (const category of notificationCategories.filter((one) => !categoriesAbout('admin').includes(one))) {
      expect(screen.getByLabelText(`${notificationCategoryInfo[category].label} — Here`)).toBeTruthy()
    }
    expect(screen.queryByLabelText('Somebody applies to join — Here')).toBeNull()
  })

  it('heads an open section with an empty corner and one cell per channel', async () => {
    render(<NotificationSettingsField api={stub()} />)

    await open('What happens to you')

    const head = [...document.querySelectorAll('.notification-settings thead th')]

    expect(head.map((cell) => cell.textContent)).toEqual(['', 'Here'])
  })

  it('gives the one-category section no expander, its header row being the row', async () => {
    render(<NotificationSettingsField api={stub()} />)

    await screen.findByText('A new version of the app is out')
    expect(screen.queryByRole('button', { name: 'A new version of the app is out' })).toBeNull()
    expect(checked('A new version of the app is out — Here')).toBe(false)
  })

  it('says which section a switch belongs to, the visible word being the same in each', async () => {
    render(<NotificationSettingsField api={stub()} />)

    expect(await screen.findByLabelText('What happens to you — Here')).toBeTruthy()
    expect(screen.getByLabelText('What others are doing — Here')).toBeTruthy()
  })

  it('adds the admin section for an admin', async () => {
    render(asAdmin(stub()))

    expect(await screen.findByText('What you look after')).toBeTruthy()
    expect(checked('What you look after — Here')).toBe(true)
  })

  it('ticks what happens to you and leaves the rest alone', async () => {
    render(<NotificationSettingsField api={stub()} />)

    await open('What happens to you')
    await open('What others are doing')
    expect(checked(MEAL)).toBe(true)
    expect(checked(DREAM_OFFERED)).toBe(false)
  })

  it('draws no table at all when the read fails', async () => {
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
    let saves = 0
    render(
      <NotificationSettingsField
        api={stub({
          getMyNotificationSettings: () => Promise.reject(apiError(500, 'internal_error', 'Nope.')),
          updateMyNotificationSettings: () => {
            saves += 1
            return Promise.resolve({ on: [], email: [], digest: 'daily' })
          },
        })}
      />,
    )

    await screen.findByRole('alert')
    expect(screen.queryByLabelText(MEAL)).toBeNull()
    expect(saves).toBe(0)
  })

  it('switches one off by unticking it', async () => {
    const update = vi.fn(() => Promise.resolve<NotificationSettings>({ on: [], email: [], digest: 'daily' }))
    render(<NotificationSettingsField api={stub({ updateMyNotificationSettings: update })} />)

    await open('What happens to you')
    fireEvent.click(screen.getByLabelText(MEAL))

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({
        on: DEFAULTS.filter((category) => category !== 'meal_role'),
        email: [],
        digest: 'daily',
      })
    })
  })

  it('switches one on by ticking it', async () => {
    const update = vi.fn(() => Promise.resolve<NotificationSettings>({ on: [], email: [], digest: 'daily' }))
    render(<NotificationSettingsField api={stub({ updateMyNotificationSettings: update })} />)

    await open('What others are doing')
    fireEvent.click(screen.getByLabelText(DREAM_OFFERED))

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({ on: [...DEFAULTS, 'dream_offered'], email: [], digest: 'daily' })
    })
  })

  it('switches a whole section on in one save, the chatty ones with it', async () => {
    const update = vi.fn(() => Promise.resolve<NotificationSettings>({ on: [], email: [], digest: 'daily' }))
    render(<NotificationSettingsField api={stub({ updateMyNotificationSettings: update })} />)

    fireEvent.click(await screen.findByLabelText('What others are doing — Here'))

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({
        on: [...DEFAULTS, ...categoriesAbout('else')],
        email: [],
        digest: 'daily',
      })
    })
  })

  it('switches a whole section off in one save, leaving the other sections alone', async () => {
    const update = vi.fn(() => Promise.resolve<NotificationSettings>({ on: [], email: [], digest: 'daily' }))
    render(
      <NotificationSettingsField
        api={stub({
          getMyNotificationSettings: () =>
            Promise.resolve({ on: [...categoriesAbout('you'), 'application'], email: [], digest: 'daily' }),
          updateMyNotificationSettings: update,
        })}
      />,
    )

    fireEvent.click(await screen.findByLabelText('What happens to you — Here'))

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({ on: ['application'], email: [], digest: 'daily' })
    })
  })

  it('turns a mixed section fully on, which is what a click on it asks for', async () => {
    const update = vi.fn(() => Promise.resolve<NotificationSettings>({ on: [], email: [], digest: 'daily' }))
    render(<NotificationSettingsField api={stub({ updateMyNotificationSettings: update })} />)

    fireEvent.click(await screen.findByLabelText('What happens to you — Here'))

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({
        on: ['application', ...categoriesAbout('you')],
        email: [],
        digest: 'daily',
      })
    })
  })

  it('shows the section switch as mixed where its categories differ', async () => {
    render(<NotificationSettingsField api={stub()} />)

    await screen.findByLabelText('What happens to you — Here')
    expect(mixed('What happens to you — Here')).toBe(true)
    expect(checked('What happens to you — Here')).toBe(false)
  })

  it('shows it plainly off where none of them is on', async () => {
    render(<NotificationSettingsField api={stub()} />)

    await screen.findByLabelText('What others are doing — Here')
    expect(mixed('What others are doing — Here')).toBe(false)
    expect(checked('What others are doing — Here')).toBe(false)
  })

  it('shows it plainly on where every one of them is', async () => {
    render(
      <NotificationSettingsField
        api={stub({
          getMyNotificationSettings: () =>
            Promise.resolve({ on: [...categoriesAbout('else')], email: [], digest: 'daily' }),
        })}
      />,
    )

    await screen.findByLabelText('What others are doing — Here')
    expect(checked('What others are doing — Here')).toBe(true)
    expect(mixed('What others are doing — Here')).toBe(false)
  })

  it('reflects a single tick back in the section switch above it', async () => {
    render(
      <NotificationSettingsField
        api={stub({
          getMyNotificationSettings: () => Promise.resolve({ on: [], email: [], digest: 'daily' }),
          updateMyNotificationSettings: () =>
            Promise.resolve({ on: ['dream_offered'], email: [], digest: 'daily' }),
        })}
      />,
    )

    await open('What others are doing')
    fireEvent.click(screen.getByLabelText(DREAM_OFFERED))

    await waitFor(() => expect(mixed('What others are doing — Here')).toBe(true))
  })

  it('offers no email column where the installation has no mail server', async () => {
    render(<NotificationSettingsField api={stub()} />)

    await open('What happens to you')
    expect(screen.queryByLabelText(MEAL_EMAIL)).toBeNull()
    expect(screen.queryByText('Email')).toBeNull()
  })

  it('offers one where it has, off for every category', async () => {
    render(<NotificationSettingsField api={stub()} sendsEmail />)

    await open('What happens to you')
    expect(checked(MEAL)).toBe(true)
    expect(checked(MEAL_EMAIL)).toBe(false)
  })

  it('sends both lists when one channel is ticked, leaving the other alone', async () => {
    const update = vi.fn(() =>
      Promise.resolve<NotificationSettings>({ on: [...DEFAULTS], email: ['meal_role'], digest: 'daily' }),
    )
    render(<NotificationSettingsField api={stub({ updateMyNotificationSettings: update })} sendsEmail />)

    await open('What happens to you')
    fireEvent.click(screen.getByLabelText(MEAL_EMAIL))

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({ on: [...DEFAULTS], email: ['meal_role'], digest: 'daily' })
    })
  })

  it('puts the box back when the save is refused', async () => {
    render(
      <NotificationSettingsField
        api={stub({
          updateMyNotificationSettings: () => Promise.reject(apiError(500, 'internal_error', 'Nope.')),
        })}
      />,
    )

    await open('What happens to you')
    fireEvent.click(screen.getByLabelText(MEAL))

    await screen.findByRole('alert')
    expect(checked(MEAL)).toBe(true)
  })
})

describe('the digest of what you have missed', () => {
  const DIGEST = 'A summary by email when you have stayed away'

  it('is not offered where the installation has no mail server', async () => {
    render(<NotificationSettingsField api={stub()} />)

    await screen.findByText('What happens to you')

    expect(screen.queryByLabelText(DIGEST)).toBeNull()
  })

  it('starts where the server left it', async () => {
    const settings: NotificationSettings = { on: [...DEFAULTS], email: [], digest: 'weekly' }
    render(
      <NotificationSettingsField
        api={stub({ getMyNotificationSettings: () => Promise.resolve(settings) })}
        sendsEmail
      />,
    )

    expect(await screen.findByLabelText(DIGEST)).toHaveProperty('value', 'weekly')
  })

  it('sends the whole set when it changes, so a choice does not clear the boxes', async () => {
    const update = vi.fn(() =>
      Promise.resolve<NotificationSettings>({ on: [...DEFAULTS], email: [], digest: 'off' }),
    )
    render(<NotificationSettingsField api={stub({ updateMyNotificationSettings: update })} sendsEmail />)

    fireEvent.change(await screen.findByLabelText(DIGEST), { target: { value: 'off' } })

    await waitFor(() => expect(update).toHaveBeenCalledWith({ on: [...DEFAULTS], email: [], digest: 'off' }))
  })

  it('puts back what the server had when the save is refused', async () => {
    const update = vi.fn(() =>
      Promise.reject(apiError(500, 'server', 'Could not save that. Please try again.')),
    )
    render(<NotificationSettingsField api={stub({ updateMyNotificationSettings: update })} sendsEmail />)

    fireEvent.change(await screen.findByLabelText(DIGEST), { target: { value: 'off' } })

    await screen.findByText(/Could not save that/)
    expect(screen.getByLabelText(DIGEST)).toHaveProperty('value', 'daily')
  })
})
