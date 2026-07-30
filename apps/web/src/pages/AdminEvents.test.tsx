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

  it('previews the welcome markdown as it is typed', async () => {
    // The reason the preview exists: otherwise the way to see a heading render
    // is to publish it to the public homepage.
    renderPage(stub())
    ;(await screen.findByRole('button', { name: 'Edit welcome text' })).click()
    await screen.findByLabelText('Welcome text (markdown)')

    fill('Welcome text (markdown)', '# Bring water')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Bring water', level: 1 })).toBeTruthy()
    })
  })

  it('escapes raw HTML in the preview, so it shows what a visitor gets', async () => {
    renderPage(stub())
    ;(await screen.findByRole('button', { name: 'Edit welcome text' })).click()
    await screen.findByLabelText('Welcome text (markdown)')

    fill('Welcome text (markdown)', '<script>alert(1)</script>')

    await waitFor(() => {
      expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeTruthy()
    })
    expect(document.querySelector('.markdown-preview script')).toBeNull()
  })

  it('saves the welcome text and confirms it', async () => {
    const updateEvent = vi.fn(() => Promise.resolve({ event: summer }))
    renderPage(stub({ updateEvent }))
    ;(await screen.findByRole('button', { name: 'Edit welcome text' })).click()
    await screen.findByLabelText('Welcome text (markdown)')

    fill('Welcome text (markdown)', '# New words')
    screen.getByRole('button', { name: 'Save welcome text' }).click()

    await waitFor(() => {
      expect(updateEvent).toHaveBeenCalledWith('e-1', { welcome_markdown: '# New words' })
    })
    expect((await screen.findByRole('status')).textContent).toContain('Saved')
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
    ;(await screen.findByRole('button', { name: 'Edit welcome text' })).click()
    await screen.findByLabelText('Welcome text (markdown)')

    screen.getByRole('button', { name: 'Save welcome text' }).click()

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
