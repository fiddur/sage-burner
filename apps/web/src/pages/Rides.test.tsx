import type { MyBurn, RideEntry } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { RidesApi } from './Rides.tsx'

import { apiError } from '../api/client.ts'
import { BurnProvider } from '../burn.tsx'
import { ViewerProvider } from '../viewer.tsx'
import { Rides } from './Rides.tsx'

afterEach(cleanup)

const ADA: Viewer = {
  status: 'signed-in',
  account: { id: 'a-1', name: 'Ada', avatar: null, roles: ['member'] },
}

const BURN: MyBurn = {
  event: {
    id: 'e-1',
    name: 'Summer burn',
    slug: 'summer-burn',
    start_date: '2026-08-01',
    end_date: '2026-08-05',
    start_time: '16:00',
    end_time: '12:00',
  },
  attendance: null,
}

const aRide = (over: Partial<RideEntry> & Pick<RideEntry, 'id'>): RideEntry => ({
  event_id: 'e-1',
  account_id: 'a-1',
  kind: 'needs',
  from: 'Göteborg',
  when: 'Friday afternoon',
  seats: 0,
  notes: '',
  created_at: '2026-07-02T00:00:00.000Z',
  name: 'Ada',
  contact: '070 111 22 33',
  ...over,
})

const stub = (over: Partial<RidesApi> = {}, rides: RideEntry[] = []): RidesApi => ({
  getRides: () => Promise.resolve({ rides }),
  addRide: () => Promise.reject(new Error('addRide is not stubbed here')),
  updateRide: () => Promise.reject(new Error('updateRide is not stubbed here')),
  deleteRide: () => Promise.reject(new Error('deleteRide is not stubbed here')),
  ...over,
})

const renderPage = (api: RidesApi, viewer: Viewer = ADA, burn: MyBurn | null = BURN) =>
  render(
    <ViewerProvider viewer={viewer}>
      <BurnProvider
        value={{ status: 'ready', burns: burn === null ? [] : [burn], selected: burn ?? undefined }}
      >
        <Rides api={api} />
      </BurnProvider>
    </ViewerProvider>,
  )

describe('the rideshare board', () => {
  it('splits the two halves under headings of their own', async () => {
    renderPage(
      stub({}, [
        aRide({ id: 'r-1', kind: 'needs', from: 'Göteborg' }),
        aRide({ id: 'r-2', kind: 'offers', from: 'Malmö', seats: 3 }),
      ]),
    )

    expect(await screen.findByRole('heading', { name: 'Looking for a lift' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Offering a lift' })).toBeTruthy()
    expect(screen.getByText(/Göteborg/)).toBeTruthy()
    expect(screen.getByText(/Malmö/)).toBeTruthy()
  })

  it('shows the contact, which is the whole point of the page', async () => {
    renderPage(stub({}, [aRide({ id: 'r-1', name: 'Ada Lovelace', contact: '070 111 22 33' })]))

    expect(await screen.findByRole('link', { name: 'Ada Lovelace' })).toBeTruthy()
    expect(screen.getByText(/070 111 22 33/)).toBeTruthy()
  })

  it('links the name to the page that says how else to reach them', async () => {
    renderPage(stub({}, [aRide({ id: 'r-1', account_id: 'a-9', name: 'Ada Lovelace' })]))

    expect((await screen.findByRole('link', { name: 'Ada Lovelace' })).getAttribute('href')).toBe(
      '/members/a-9',
    )
  })

  it('says so when a half is empty rather than leaving a gap', async () => {
    renderPage(stub({}, [aRide({ id: 'r-1', kind: 'needs' })]))

    expect(await screen.findByText('Nobody has offered one yet.')).toBeTruthy()
    expect(screen.queryByText('Nobody is looking for a lift yet.')).toBeNull()
  })

  it('posts a journey with what was typed', async () => {
    const addRide = vi.fn<RidesApi['addRide']>(() =>
      Promise.resolve({
        ride: {
          id: 'r-9',
          event_id: 'e-1',
          account_id: 'a-1',
          kind: 'needs',
          from: 'Oslo',
          when: 'Thursday',
          seats: 0,
          notes: '',
          created_at: '2026-07-02T00:00:00.000Z',
        },
      }),
    )
    renderPage(stub({ addRide }))

    fireEvent.input(await screen.findByRole('textbox', { name: 'From where?' }), {
      target: { value: '  Oslo  ' },
    })
    fireEvent.input(screen.getByRole('textbox', { name: 'When, roughly?' }), {
      target: { value: 'Thursday' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Post it' }))

    await waitFor(() =>
      expect(addRide).toHaveBeenCalledWith('e-1', {
        kind: 'needs',
        from: 'Oslo',
        when: 'Thursday',
        seats: 0,
        notes: '',
      }),
    )
  })

  it('asks for seats only when there is a car', async () => {
    renderPage(stub())
    await screen.findByRole('textbox', { name: 'From where?' })

    expect(screen.queryByRole('spinbutton', { name: 'How many seats?' })).toBeNull()

    fireEvent.change(screen.getByRole('combobox', { name: 'Which is it?' }), {
      target: { value: 'offers' },
    })

    expect(await screen.findByRole('spinbutton', { name: 'How many seats?' })).toBeTruthy()
  })

  it('sends the seats on an offer', async () => {
    const addRide = vi.fn<RidesApi['addRide']>(() => Promise.reject(new Error('stop here')))
    renderPage(stub({ addRide }))
    await screen.findByRole('textbox', { name: 'From where?' })

    fireEvent.change(screen.getByRole('combobox', { name: 'Which is it?' }), {
      target: { value: 'offers' },
    })
    fireEvent.input(screen.getByRole('textbox', { name: 'From where?' }), { target: { value: 'Malmö' } })
    fireEvent.input(screen.getByRole('textbox', { name: 'When, roughly?' }), { target: { value: 'Friday' } })
    fireEvent.input(await screen.findByRole('spinbutton', { name: 'How many seats?' }), {
      target: { value: '3' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Post it' }))

    await waitFor(() =>
      expect(addRide).toHaveBeenCalledWith('e-1', expect.objectContaining({ kind: 'offers', seats: 3 })),
    )
  })

  it('refuses a journey with nowhere to come from, here rather than at the server', async () => {
    const addRide = vi.fn<RidesApi['addRide']>(() => Promise.reject(new Error('should not be reached')))
    renderPage(stub({ addRide }))

    fireEvent.click(await screen.findByRole('button', { name: 'Post it' }))

    expect((await screen.findByRole('alert')).textContent).toContain('where from and roughly when')
    expect(addRide).not.toHaveBeenCalled()
  })

  it('offers the pen and the bin on your own journey only', async () => {
    renderPage(
      stub({}, [
        aRide({ id: 'r-1', account_id: 'a-1', from: 'Göteborg' }),
        aRide({ id: 'r-2', account_id: 'a-2', from: 'Malmö', name: 'Bea' }),
      ]),
    )

    expect(await screen.findByRole('button', { name: 'Edit your journey from Göteborg' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit your journey from Malmö' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Take down your journey from Malmö' })).toBeNull()
  })

  it('edits one in place, sending only what the form holds', async () => {
    const updateRide = vi.fn<RidesApi['updateRide']>(() => Promise.reject(new Error('stop here')))
    renderPage(stub({ updateRide }, [aRide({ id: 'r-1', from: 'Göteborg', when: 'Friday afternoon' })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Edit your journey from Göteborg' }))
    fireEvent.input(await screen.findByRole('textbox', { name: 'When, for your journey from Göteborg' }), {
      target: { value: 'Saturday morning' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateRide).toHaveBeenCalledWith('r-1', {
        from: 'Göteborg',
        when: 'Saturday morning',
        seats: 0,
        notes: '',
      }),
    )
  })

  it('takes one down', async () => {
    const deleteRide = vi.fn<RidesApi['deleteRide']>(() => Promise.resolve(undefined))
    renderPage(stub({ deleteRide }, [aRide({ id: 'r-1', from: 'Göteborg' })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Take down your journey from Göteborg' }))
    fireEvent.click(screen.getByRole('button', { name: 'Really take down your journey from Göteborg' }))

    await waitFor(() => expect(deleteRide).toHaveBeenCalledWith('r-1'))
  })

  it('shows what the server said when a write is refused', async () => {
    renderPage(
      stub({ deleteRide: () => Promise.reject(apiError(403, 'forbidden', 'That is not yours.')) }, [
        aRide({ id: 'r-1', from: 'Göteborg' }),
      ]),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Take down your journey from Göteborg' }))
    fireEvent.click(screen.getByRole('button', { name: 'Really take down your journey from Göteborg' }))

    expect((await screen.findByRole('alert')).textContent).toContain('That is not yours.')
  })

  it('says there is nowhere to travel to when no burn is chosen', async () => {
    renderPage(stub(), ADA, null)

    expect(await screen.findByText(/there is nowhere to travel to/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Post it' })).toBeNull()
  })

  it('does not fetch for somebody who is neither a member nor an admin', async () => {
    const getRides = vi.fn<RidesApi['getRides']>(() => Promise.resolve({ rides: [] }))
    renderPage(stub({ getRides }), { status: 'signed-out' })

    expect(screen.getByText(/for members/)).toBeTruthy()
    expect(getRides).not.toHaveBeenCalled()
  })

  it('surfaces a failure to load', async () => {
    renderPage(stub({ getRides: () => Promise.reject(new Error('nope')) }))

    expect((await screen.findByRole('alert')).textContent).toContain('Could not load')
  })
})
