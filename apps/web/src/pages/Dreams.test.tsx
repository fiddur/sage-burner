import type { Place, Session } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { DreamsApi } from './Dreams.tsx'

import { apiError } from '../api/client.ts'
import { ViewerProvider } from '../viewer.tsx'
import { Dreams } from './Dreams.tsx'

afterEach(cleanup)

const MEMBER: Viewer = { status: 'signed-in', account: { id: 'a-1', name: null, roles: ['member'] } }

const BURN = {
  id: 'e-1',
  name: 'Summer burn',
  slug: 'summer-burn',
  start_date: '2026-08-01',
  end_date: '2026-08-05',
  start_time: '16:00',
  end_time: '12:00',
  welcome_markdown: '',
  member_cap: 42,
  created_at: '2026-07-02T00:00:00.000Z',
}

const TEMPLE: Place = { id: 'p-1', event_id: 'e-1', order: 0, name: 'Temple', emoji: '🛕', color: 'yellow' }

const aDream = (over: Partial<Session> & Pick<Session, 'id' | 'title'>): Session => ({
  event_id: 'e-1',
  host_account_id: 'a-1',
  description: '',
  time_slot_start: null,
  time_slot_end: null,
  place_id: null,
  ...over,
})

const stub = (over: Partial<DreamsApi> = {}, sessions: Session[] = []): DreamsApi => ({
  getActiveEvent: () => Promise.resolve({ event: BURN }),
  getSessions: () => Promise.resolve({ sessions }),
  getPlaces: () => Promise.resolve({ places: [TEMPLE] }),
  offerSession: () => Promise.reject(new Error('offerSession is not stubbed here')),
  updateSession: () => Promise.reject(new Error('updateSession is not stubbed here')),
  withdrawSession: () => Promise.reject(new Error('withdrawSession is not stubbed here')),
  ...over,
})

const renderPage = (api: DreamsApi, viewer: Viewer = MEMBER) =>
  render(
    <ViewerProvider viewer={viewer}>
      <Dreams api={api} />
    </ViewerProvider>,
  )

describe('Dreams', () => {
  it('says so when nobody has offered one', async () => {
    renderPage(stub())

    expect(await screen.findByText(/Nobody has offered a dream yet/)).toBeTruthy()
  })

  it('shows an unscheduled dream as unscheduled rather than blank', async () => {
    // Most dreams sit here right up until the burn. A blank cell reads as a bug.
    renderPage(stub({}, [aDream({ id: 's-1', title: 'Sunrise yoga' })]))

    expect(await screen.findByText('Sunrise yoga')).toBeTruthy()
    expect(screen.getByText('not scheduled yet')).toBeTruthy()
  })

  it('shows a scheduled dream with its place', async () => {
    renderPage(
      stub({}, [
        aDream({
          id: 's-1',
          title: 'Cacao ceremony',
          place_id: 'p-1',
          time_slot_start: '2026-08-02T18:00:00.000Z',
          time_slot_end: '2026-08-02T20:00:00.000Z',
        }),
      ]),
    )

    expect(await screen.findByText('🛕 Temple')).toBeTruthy()
    expect(screen.queryByText('not scheduled yet')).toBeNull()
  })

  it('offers one with just a name', async () => {
    const offerSession = vi.fn<DreamsApi['offerSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-2', title: 'Sunrise yoga' }) }),
    )
    renderPage(stub({ offerSession }))

    fireEvent.input(await screen.findByRole('textbox', { name: 'What is it?' }), {
      target: { value: '  Sunrise yoga  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Offer it' }))

    await waitFor(() => expect(offerSession).toHaveBeenCalledWith({ title: 'Sunrise yoga', description: '' }))
  })

  it('refuses a nameless dream here rather than letting the server say no', async () => {
    const offerSession = vi.fn<DreamsApi['offerSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-2', title: 'x' }) }),
    )
    renderPage(stub({ offerSession }))

    fireEvent.click(await screen.findByRole('button', { name: 'Offer it' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Give your dream a name')
    expect(offerSession).not.toHaveBeenCalled()
  })

  it('schedules one into a place and a slot, sending UTC', async () => {
    // The inputs speak local wall-clock time; the API speaks UTC. The suite is
    // pinned to Europe/Stockholm in `vite.config.ts`, so 20:00 local in August
    // is 18:00Z and this literal is stable.
    const updateSession = vi.fn<DreamsApi['updateSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'Sunrise yoga' }) }),
    )
    renderPage(stub({ updateSession }, [aDream({ id: 's-1', title: 'Sunrise yoga' })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Sunrise yoga' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Place for Sunrise yoga' }), {
      target: { value: 'p-1' },
    })
    fireEvent.input(screen.getByLabelText('Start of Sunrise yoga'), {
      target: { value: '2026-08-02T20:00' },
    })
    fireEvent.input(screen.getByLabelText('End of Sunrise yoga'), {
      target: { value: '2026-08-02T22:00' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateSession).toHaveBeenCalledWith('s-1', {
        place_id: 'p-1',
        time_slot_start: '2026-08-02T18:00:00.000Z',
        time_slot_end: '2026-08-02T20:00:00.000Z',
      }),
    )
  })

  it('shows a stored slot back in local time, not UTC', async () => {
    renderPage(
      stub({}, [
        aDream({
          id: 's-1',
          title: 'Cacao ceremony',
          time_slot_start: '2026-08-02T18:00:00.000Z',
          time_slot_end: '2026-08-02T20:00:00.000Z',
        }),
      ]),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Cacao ceremony' }))

    expect(screen.getByLabelText('Start of Cacao ceremony')).toHaveProperty('value', '2026-08-02T20:00')
  })

  it('unschedules by choosing nowhere and clearing both ends', async () => {
    const updateSession = vi.fn<DreamsApi['updateSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'Cacao ceremony' }) }),
    )
    renderPage(
      stub({ updateSession }, [
        aDream({
          id: 's-1',
          title: 'Cacao ceremony',
          place_id: 'p-1',
          time_slot_start: '2026-08-02T18:00:00.000Z',
          time_slot_end: '2026-08-02T20:00:00.000Z',
        }),
      ]),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Cacao ceremony' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Place for Cacao ceremony' }), {
      target: { value: '' },
    })
    fireEvent.input(screen.getByLabelText('Start of Cacao ceremony'), { target: { value: '' } })
    fireEvent.input(screen.getByLabelText('End of Cacao ceremony'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateSession).toHaveBeenCalledWith('s-1', {
        place_id: null,
        time_slot_start: null,
        time_slot_end: null,
      }),
    )
  })

  it('sends only what this form changed, so a title fix cannot unschedule a dream', async () => {
    // Concurrent editing is the premise of the page: another member may schedule
    // this dream while the form is open. Sending the whole row would put back the
    // place and slot as they were at mount and undo their work.
    const updateSession = vi.fn<DreamsApi['updateSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'Renamed' }) }),
    )
    renderPage(
      stub({ updateSession }, [
        aDream({
          id: 's-1',
          title: 'Cacao ceremony',
          place_id: 'p-1',
          time_slot_start: '2026-08-02T18:00:00.000Z',
          time_slot_end: '2026-08-02T20:00:00.000Z',
        }),
      ]),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Cacao ceremony' }))
    fireEvent.input(screen.getByLabelText('Title of Cacao ceremony'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateSession).toHaveBeenCalledWith('s-1', { title: 'Renamed' }))
  })

  it('leaves a slot carrying seconds alone when only the title was touched', async () => {
    // The inputs are minute-precision, so a stored slot with seconds does not
    // round-trip. Comparing the round-tripped value against the raw one would
    // call an untouched field changed and quietly zero the seconds.
    const updateSession = vi.fn<DreamsApi['updateSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'Renamed' }) }),
    )
    renderPage(
      stub({ updateSession }, [
        aDream({
          id: 's-1',
          title: 'Cacao ceremony',
          time_slot_start: '2026-08-02T18:00:30.000Z',
          time_slot_end: '2026-08-02T20:00:45.000Z',
        }),
      ]),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Cacao ceremony' }))
    fireEvent.input(screen.getByLabelText('Title of Cacao ceremony'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateSession).toHaveBeenCalledWith('s-1', { title: 'Renamed' }))
  })

  it('sends nothing at all when the form was opened and closed unchanged', async () => {
    // An empty body is the documented no-op read, so this is harmless — but it
    // is worth pinning that an untouched save cannot carry a value.
    const updateSession = vi.fn<DreamsApi['updateSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'Cacao ceremony' }) }),
    )
    renderPage(stub({ updateSession }, [aDream({ id: 's-1', title: 'Cacao ceremony', place_id: 'p-1' })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Cacao ceremony' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateSession).toHaveBeenCalledWith('s-1', {}))
  })

  it('binds the two ends of the slot to each other', async () => {
    renderPage(
      stub({}, [
        aDream({
          id: 's-1',
          title: 'Cacao ceremony',
          time_slot_start: '2026-08-02T18:00:00.000Z',
          time_slot_end: '2026-08-02T20:00:00.000Z',
        }),
      ]),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Cacao ceremony' }))

    // Local time, since the suite is pinned to Europe/Stockholm.
    expect(screen.getByLabelText('Start of Cacao ceremony').getAttribute('max')).toBe('2026-08-02T22:00')
    expect(screen.getByLabelText('End of Cacao ceremony').getAttribute('min')).toBe('2026-08-02T20:00')
  })

  it('withdraws one', async () => {
    const withdrawSession = vi.fn<DreamsApi['withdrawSession']>(() => Promise.resolve(undefined))
    renderPage(stub({ withdrawSession }, [aDream({ id: 's-1', title: 'Sunrise yoga' })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw Sunrise yoga' }))

    await waitFor(() => expect(withdrawSession).toHaveBeenCalledWith('s-1'))
  })

  it('lets a member edit a dream someone else offered', async () => {
    // #20: the schedule belongs to the members, not to the dream's host.
    const updateSession = vi.fn<DreamsApi['updateSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'Theirs' }) }),
    )
    renderPage(stub({ updateSession }, [aDream({ id: 's-1', title: 'Theirs', host_account_id: 'a-9' })]))

    expect(await screen.findByRole('button', { name: 'Edit Theirs' })).toBeTruthy()
  })

  it('shows what the server said when a write is refused', async () => {
    renderPage(
      stub({ withdrawSession: () => Promise.reject(apiError(400, 'bad_request', 'That will not do.')) }, [
        aDream({ id: 's-1', title: 'Sunrise yoga' }),
      ]),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw Sunrise yoga' }))

    expect((await screen.findByRole('alert')).textContent).toContain('That will not do.')
  })

  it('surfaces a failure to load', async () => {
    renderPage(stub({ getSessions: () => Promise.reject(new Error('nope')) }))

    expect((await screen.findByRole('alert')).textContent).toContain('Could not load')
  })

  it('does not fetch for someone who is not a member', async () => {
    const getSessions = vi.fn<DreamsApi['getSessions']>(() => Promise.resolve({ sessions: [] }))
    renderPage(stub({ getSessions }), { status: 'signed-out' })

    expect(screen.getByText(/for members/)).toBeTruthy()
    expect(getSessions).not.toHaveBeenCalled()
  })
})
