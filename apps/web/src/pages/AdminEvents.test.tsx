import type { Event } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { EventsApi } from './AdminEvents.tsx'

import { apiError } from '../api/client.ts'
import { ViewerProvider } from '../viewer.tsx'
import { AdminEvents } from './AdminEvents.tsx'

afterEach(cleanup)

const ADMIN = { status: 'signed-in' as const, account: { id: 'a-1', roles: ['admin' as const] } }

const summer: Event = {
  id: 'e-1',
  name: 'Summer Burn 2026',
  slug: 'summer-2026',
  start_date: '2026-08-01',
  end_date: '2026-08-05',
  start_time: '00:00',
  end_time: '23:59',
  welcome_markdown: '# Hello',
  member_cap: 42,
  created_at: '2026-01-01T00:00:00.000Z',
}

const stub = (over: Partial<EventsApi> = {}): EventsApi => ({
  getEvents: () => Promise.resolve({ events: [summer] }),
  createEvent: () => Promise.reject(new Error('createEvent is not stubbed here')),
  updateEvent: () => Promise.reject(new Error('updateEvent is not stubbed here')),
  ...over,
})

const renderPage = (api: EventsApi) =>
  render(
    <ViewerProvider viewer={ADMIN}>
      <AdminEvents api={api} />
    </ViewerProvider>,
  )

const fill = (label: string, value: string) =>
  fireEvent.input(screen.getByLabelText(label), { target: { value } })

describe('AdminEvents', () => {
  it('lists the events', async () => {
    renderPage(stub())

    expect(await screen.findByText('Summer Burn 2026')).toBeTruthy()
    expect(screen.getByText(/summer-2026/)).toBeTruthy()
  })

  it('says so when there are none yet', async () => {
    renderPage(stub({ getEvents: () => Promise.resolve({ events: [] }) }))

    expect(await screen.findByText(/No events yet/)).toBeTruthy()
  })

  it('binds the two dates to each other, so the picker cannot invert the burn', async () => {
    renderPage(stub())
    await screen.findByText('Summer Burn 2026')

    fill('Starts', '2026-12-01')
    fill('Ends', '2026-12-05')

    expect(screen.getByLabelText('Starts').getAttribute('max')).toBe('2026-12-05')
    expect(screen.getByLabelText('Ends').getAttribute('min')).toBe('2026-12-01')
  })

  it('lets an organiser set the hours the burn is open', async () => {
    // The grid runs between these, so they are on the create form rather than
    // hidden behind an edit — an organiser who has to find them later gets a
    // schedule covering three whole days for a burn that is two half ones.
    const created: Event = { ...summer, id: 'e-3', slug: 'winter-2026' }
    const createEvent = vi.fn(() => Promise.resolve({ event: created }))
    renderPage(stub({ createEvent }))
    await screen.findByText('Summer Burn 2026')

    fill('Name', 'Winter Burn')
    fill('Slug', 'winter-2026')
    fill('Starts', '2026-12-01')
    fill('Starting time', '15:00')
    fill('Ends', '2026-12-05')
    fill('Ending time', '12:00')
    screen.getByRole('button', { name: 'Create event' }).click()

    await waitFor(() =>
      expect(createEvent).toHaveBeenCalledWith(
        expect.objectContaining({ start_time: '15:00', end_time: '12:00' }),
      ),
    )
  })

  it('creates an event and shows it without a reload', async () => {
    const created: Event = { ...summer, id: 'e-2', name: 'Winter Burn', slug: 'winter-2026' }
    const createEvent = vi.fn(() => Promise.resolve({ event: created }))
    renderPage(stub({ createEvent }))
    await screen.findByText('Summer Burn 2026')

    fill('Name', 'Winter Burn')
    fill('Slug', 'winter-2026')
    fill('Starts', '2026-12-01')
    fill('Ends', '2026-12-05')
    screen.getByRole('button', { name: 'Create event' }).click()

    await waitFor(() => {
      expect(createEvent).toHaveBeenCalledWith({
        name: 'Winter Burn',
        slug: 'winter-2026',
        start_date: '2026-12-01',
        end_date: '2026-12-05',
        start_time: '00:00',
        end_time: '23:59',
        welcome_markdown: '',
        member_cap: 42,
      })
    })
    expect(await screen.findByText('Winter Burn')).toBeTruthy()
  })

  it('explains a taken slug rather than showing the raw error', async () => {
    // 409 is the one failure an organiser can act on unaided.
    renderPage(
      stub({ createEvent: () => Promise.reject(apiError(409, 'conflict', 'Request failed (409).')) }),
    )
    await screen.findByText('Summer Burn 2026')

    fill('Name', 'Clash')
    fill('Slug', 'summer-2026')
    fill('Starts', '2026-12-01')
    fill('Ends', '2026-12-05')
    screen.getByRole('button', { name: 'Create event' }).click()

    expect((await screen.findByRole('alert')).textContent).toBe('That slug is already taken — pick another.')
  })

  it('keeps a newly created event in start-date order', async () => {
    // The list comes back ordered by start date; appending would show a winter
    // event above a summer one until the next reload.
    const winter: Event = {
      ...summer,
      id: 'e-0',
      name: 'Winter Burn',
      slug: 'winter-2025',
      start_date: '2025-12-01',
      end_date: '2025-12-05',
    }
    renderPage(stub({ createEvent: () => Promise.resolve({ event: winter }) }))
    await screen.findByText('Summer Burn 2026')

    fill('Name', 'Winter Burn')
    fill('Slug', 'winter-2025')
    fill('Starts', '2025-12-01')
    fill('Ends', '2025-12-05')
    screen.getByRole('button', { name: 'Create event' }).click()

    await screen.findByText('Winter Burn')
    const names = screen.getAllByRole('heading', { level: 2 })
    expect(names.map((node) => node.textContent)).toEqual(['Winter Burn', 'Summer Burn 2026', 'New event'])
  })

  it('previews the welcome markdown as it is typed', async () => {
    // The reason the preview exists: otherwise the way to see a heading render
    // is to publish it to the public homepage.
    renderPage(stub())
    ;(await screen.findByRole('button', { name: 'Edit event' })).click()
    await screen.findByLabelText('Welcome text (markdown)')

    fill('Welcome text (markdown)', '# Bring water')

    await waitFor(() => {
      // Level 2, matching what the public page renders — the preview is only
      // useful if it shows the same thing.
      expect(screen.getByRole('heading', { name: 'Bring water', level: 2 })).toBeTruthy()
    })
  })

  it('escapes raw HTML in the preview, so it shows what a visitor gets', async () => {
    renderPage(stub())
    ;(await screen.findByRole('button', { name: 'Edit event' })).click()
    await screen.findByLabelText('Welcome text (markdown)')

    fill('Welcome text (markdown)', '<script>alert(1)</script>')

    await waitFor(() => {
      expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeTruthy()
    })
    expect(document.querySelector('.markdown-preview script')).toBeNull()
  })

  it('edits the hours and the cap of a burn that already exists', async () => {
    // There was no way to change either after creation — the edit form offered
    // the welcome text and nothing else, so a burn created with the default
    // 00:00–23:59 was stuck with a schedule covering whole days.
    const updateEvent = vi.fn(() => Promise.resolve({ event: summer }))
    renderPage(stub({ updateEvent }))
    ;(await screen.findByRole('button', { name: 'Edit event' })).click()
    await screen.findByLabelText('Start time of summer-2026')

    fill('Start time of summer-2026', '15:00')
    fill('End time of summer-2026', '12:00')
    fill('Member cap of summer-2026', '30')
    screen.getByRole('button', { name: 'Save event' }).click()

    await waitFor(() =>
      expect(updateEvent).toHaveBeenCalledWith(
        'e-1',
        expect.objectContaining({ start_time: '15:00', end_time: '12:00', member_cap: 30 }),
      ),
    )
  })

  it('seeds the edit form from the event rather than leaving it blank', async () => {
    renderPage(stub())
    ;(await screen.findByRole('button', { name: 'Edit event' })).click()

    expect(await screen.findByLabelText('Name of summer-2026')).toHaveProperty('value', 'Summer Burn 2026')
    expect(screen.getByLabelText('Start date of summer-2026')).toHaveProperty('value', '2026-08-01')
    expect(screen.getByLabelText('Member cap of summer-2026')).toHaveProperty('value', '42')
  })

  it('binds the editor\u2019s date pair too, not only the create form\u2019s', async () => {
    renderPage(stub())
    ;(await screen.findByRole('button', { name: 'Edit event' })).click()
    await screen.findByLabelText('Start date of summer-2026')

    expect(screen.getByLabelText('Start date of summer-2026').getAttribute('max')).toBe('2026-08-05')
    expect(screen.getByLabelText('End date of summer-2026').getAttribute('min')).toBe('2026-08-01')
  })

  it('refuses a cap that is not a whole number, rather than sending NaN', async () => {
    const updateEvent = vi.fn(() => Promise.resolve({ event: summer }))
    renderPage(stub({ updateEvent }))
    ;(await screen.findByRole('button', { name: 'Edit event' })).click()
    await screen.findByLabelText('Member cap of summer-2026')

    fill('Member cap of summer-2026', '0')
    screen.getByRole('button', { name: 'Save event' }).click()

    expect((await screen.findByRole('alert')).textContent).toContain('whole number')
    expect(updateEvent).not.toHaveBeenCalled()
  })

  it('shows the row the server returned, not the draft that was sent', async () => {
    // The server trims and may adjust; echoing the draft would draw a save that
    // did not happen the way it is shown.
    const updateEvent = vi.fn(() => Promise.resolve({ event: { ...summer, name: 'Trimmed By Server' } }))
    renderPage(stub({ updateEvent }))
    ;(await screen.findByRole('button', { name: 'Edit event' })).click()
    await screen.findByLabelText('Name of summer-2026')

    fill('Name of summer-2026', '  Something Else  ')
    screen.getByRole('button', { name: 'Save event' }).click()

    expect(await screen.findByText('Trimmed By Server')).toBeTruthy()
  })

  it('resyncs the open form from the server, not only the list', async () => {
    // Otherwise the header shows what was stored and the inputs still show what
    // was typed, which is the same inconsistency one level in.
    const updateEvent = vi.fn(() => Promise.resolve({ event: { ...summer, name: 'Trimmed By Server' } }))
    renderPage(stub({ updateEvent }))
    ;(await screen.findByRole('button', { name: 'Edit event' })).click()
    await screen.findByLabelText('Name of summer-2026')

    fill('Name of summer-2026', '  Something Else  ')
    fill('Welcome text (markdown)', '# Typed but not stored')
    screen.getByRole('button', { name: 'Save event' }).click()

    await waitFor(() =>
      expect(screen.getByLabelText('Name of summer-2026')).toHaveProperty('value', 'Trimmed By Server'),
    )
    // Bound separately from the rest, so it needs resyncing on its own.
    expect(screen.getByLabelText('Welcome text (markdown)')).toHaveProperty('value', '# Hello')
  })

  it('saves the whole event, not only the welcome text', async () => {
    const updateEvent = vi.fn(() => Promise.resolve({ event: summer }))
    renderPage(stub({ updateEvent }))
    ;(await screen.findByRole('button', { name: 'Edit event' })).click()
    await screen.findByLabelText('Welcome text (markdown)')

    fill('Welcome text (markdown)', '# New words')
    screen.getByRole('button', { name: 'Save event' }).click()

    await waitFor(() => {
      expect(updateEvent).toHaveBeenCalledWith('e-1', {
        name: 'Summer Burn 2026',
        start_date: '2026-08-01',
        end_date: '2026-08-05',
        start_time: '00:00',
        end_time: '23:59',
        member_cap: 42,
        welcome_markdown: '# New words',
      })
    })
    // Pinned in full, because this one sentence has been wrong three times
    // running: it over-promised, then hedged with an issue number that went
    // stale, then over-promised again for a new reason — the list offers "Edit
    // welcome text" on every event, while only the soonest-ending unfinished
    // one reaches the homepage. So an organiser editing last year's burn was
    // told the homepage shows text it does not and never will.
    //
    // The wording is conditional, which makes it true for every event rather
    // than for the one the previous versions assumed. Pinning it whole means
    // the next rewrite has to be a decision.
    expect((await screen.findByRole('status')).textContent).toBe(
      'Saved. It appears on the homepage while this is the current burn.',
    )
  })

  it('surfaces a failed save rather than claiming success', async () => {
    renderPage(
      stub({
        updateEvent: () =>
          Promise.reject(
            apiError(500, 'internal_error', 'Something went wrong at our end. Please try again.'),
          ),
      }),
    )
    ;(await screen.findByRole('button', { name: 'Edit event' })).click()
    await screen.findByLabelText('Welcome text (markdown)')

    screen.getByRole('button', { name: 'Save event' }).click()

    expect((await screen.findByRole('alert')).textContent).toContain('went wrong')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('does not fetch for someone without the role', async () => {
    const getEvents = vi.fn(() => Promise.reject(new Error('should not be called')))
    render(
      <ViewerProvider viewer={{ status: 'signed-in', account: { id: 'a-2', roles: ['member'] } }}>
        <AdminEvents api={stub({ getEvents })} />
      </ViewerProvider>,
    )

    expect(await screen.findByText(/for organisers/)).toBeTruthy()
    expect(getEvents).not.toHaveBeenCalled()
  })
})
