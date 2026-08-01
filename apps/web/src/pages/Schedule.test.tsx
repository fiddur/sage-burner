import type { Event, Place, Session } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { ScheduleApi } from './Schedule.tsx'

import { apiError } from '../api/client.ts'
import { ViewerProvider } from '../viewer.tsx'
import { Schedule } from './Schedule.tsx'

afterEach(cleanup)

const MEMBER: Viewer = { status: 'signed-in', account: { id: 'a-1', roles: ['member'] } }

const BURN: Event = {
  id: 'e-1',
  name: 'Summer burn',
  slug: 'summer-2026',
  start_date: '2026-08-01',
  end_date: '2026-08-02',
  welcome_markdown: '',
  member_cap: 42,
  created_at: '2026-07-02T00:00:00.000Z',
}

const TEMPLE: Place = { id: 'p-1', order: 0, name: 'Temple', emoji: '🛕', color: 'yellow' }
const SAUNA: Place = { id: 'p-2', order: 1, name: 'Sauna', emoji: '🥵', color: 'red' }

const aDream = (over: Partial<Session> & Pick<Session, 'id' | 'title'>): Session => ({
  event_id: 'e-1',
  host_account_id: 'a-1',
  description: '',
  time_slot_start: null,
  time_slot_end: null,
  place_id: null,
  ...over,
})

const stub = (
  over: Partial<ScheduleApi> = {},
  sessions: Session[] = [],
  places: Place[] = [TEMPLE, SAUNA],
  event: Event | null = BURN,
): ScheduleApi => ({
  getActiveEvent: () => Promise.resolve({ event }),
  getPlaces: () => Promise.resolve({ places }),
  getSessions: () => Promise.resolve({ sessions }),
  updateSession: () => Promise.reject(new Error('updateSession is not stubbed here')),
  ...over,
})

const renderPage = (api: ScheduleApi, viewer: Viewer = MEMBER) =>
  render(
    <ViewerProvider viewer={viewer}>
      <Schedule api={api} />
    </ViewerProvider>,
  )

/** The cell for a given hour row and place column. */
const cell = (rowLabel: string, column: number) => {
  const header = [...document.querySelectorAll('.schedule-grid th[scope="row"]')].find(
    (node) => node.textContent === rowLabel,
  )
  const cells = header?.parentElement?.querySelectorAll('td')

  if (cells?.[column] === undefined) throw new Error(`no cell at ${rowLabel} column ${column}`)

  return cells[column]
}

describe('Schedule', () => {
  it('draws a lane per place and an hour per row for the whole burn', async () => {
    renderPage(stub())

    expect(await screen.findByRole('columnheader', { name: /Temple/ })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: /Sauna/ })).toBeTruthy()
    // Two days, 24 rows each.
    expect(document.querySelectorAll('.schedule-grid th[scope="row"]')).toHaveLength(48)
  })

  it('lists an unplaced dream in the pool rather than in the grid', async () => {
    renderPage(stub({}, [aDream({ id: 's-1', title: 'Sunrise yoga' })]))

    const pool = await screen.findByRole('complementary')

    expect(pool.textContent).toContain('Sunrise yoga')
    expect(document.querySelector('.schedule-grid')?.textContent).not.toContain('Sunrise yoga')
  })

  it('counts a dream with a time but no place as unplaced', async () => {
    // It cannot be drawn in a lane, so the pool is the only honest place for it.
    renderPage(
      stub({}, [
        aDream({
          id: 's-1',
          title: 'Homeless',
          time_slot_start: '2026-08-01T10:00:00.000Z',
          time_slot_end: '2026-08-01T11:00:00.000Z',
        }),
      ]),
    )

    expect((await screen.findByRole('complementary')).textContent).toContain('Homeless')
  })

  it('counts a dream with a place but no time as unplaced', async () => {
    // The other half of the pair above: no row to draw it in, so the pool is
    // where it belongs. Both halves are needed — either condition alone leaves
    // the other kind stranded invisibly.
    renderPage(stub({}, [aDream({ id: 's-1', title: 'Timeless', place_id: 'p-1' })]))

    expect((await screen.findByRole('complementary')).textContent).toContain('Timeless')
    expect(document.querySelector('.schedule-grid')?.textContent).not.toContain('Timeless')
  })

  it('draws a scheduled dream in its own lane and hour, in local time', async () => {
    // Pinned to Europe/Stockholm: 08:00Z in August is the 10:00 row.
    renderPage(
      stub({}, [
        aDream({
          id: 's-1',
          title: 'Cacao ceremony',
          place_id: 'p-2',
          time_slot_start: '2026-08-01T08:00:00.000Z',
          time_slot_end: '2026-08-01T09:00:00.000Z',
        }),
      ]),
    )

    await screen.findByRole('columnheader', { name: /Sauna/ })

    expect(cell('10:00', 1).textContent).toContain('Cacao ceremony')
    expect(cell('10:00', 0).textContent).not.toContain('Cacao ceremony')
    expect(cell('08:00', 1).textContent).not.toContain('Cacao ceremony')
  })

  it('schedules a dream dropped into a cell, for that hour', async () => {
    const updateSession = vi.fn<ScheduleApi['updateSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'Sunrise yoga' }) }),
    )
    renderPage(stub({ updateSession }, [aDream({ id: 's-1', title: 'Sunrise yoga' })]))

    fireEvent.dragStart(await screen.findByLabelText('Move Sunrise yoga'))
    fireEvent.drop(cell('10:00', 0))

    await waitFor(() =>
      expect(updateSession).toHaveBeenCalledWith('s-1', {
        place_id: 'p-1',
        time_slot_start: '2026-08-01T08:00:00.000Z',
        time_slot_end: '2026-08-01T09:00:00.000Z',
      }),
    )
  })

  it('unschedules a dream dropped back on the pool', async () => {
    const updateSession = vi.fn<ScheduleApi['updateSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'Cacao ceremony' }) }),
    )
    renderPage(
      stub({ updateSession }, [
        aDream({
          id: 's-1',
          title: 'Cacao ceremony',
          place_id: 'p-1',
          time_slot_start: '2026-08-01T08:00:00.000Z',
          time_slot_end: '2026-08-01T09:00:00.000Z',
        }),
      ]),
    )

    fireEvent.dragStart(await screen.findByLabelText('Move Cacao ceremony'))
    fireEvent.drop(screen.getByRole('complementary'))

    await waitFor(() =>
      expect(updateSession).toHaveBeenCalledWith('s-1', {
        place_id: null,
        time_slot_start: null,
        time_slot_end: null,
      }),
    )
  })

  it('does nothing when a cell is dropped on with nothing being dragged', async () => {
    const updateSession = vi.fn<ScheduleApi['updateSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'x' }) }),
    )
    renderPage(stub({ updateSession }, [aDream({ id: 's-1', title: 'Sunrise yoga' })]))

    await screen.findByRole('columnheader', { name: /Temple/ })
    fireEvent.drop(cell('10:00', 0))

    expect(updateSession).not.toHaveBeenCalled()
  })

  it('says so when no burn is open, rather than drawing an empty grid', async () => {
    renderPage(stub({}, [], [TEMPLE], null))

    expect(await screen.findByText(/no burn scheduled/)).toBeTruthy()
    expect(document.querySelector('.schedule-grid')).toBeNull()
  })

  it('points at the places page when there are no lanes yet', async () => {
    renderPage(stub({}, [], []))

    expect(await screen.findByRole('link', { name: 'Places' })).toBeTruthy()
    expect(document.querySelector('.schedule-grid')).toBeNull()
  })

  it('shows what the server said when a move is refused', async () => {
    renderPage(
      stub({ updateSession: () => Promise.reject(apiError(400, 'bad_request', 'That will not do.')) }, [
        aDream({ id: 's-1', title: 'Sunrise yoga' }),
      ]),
    )

    fireEvent.dragStart(await screen.findByLabelText('Move Sunrise yoga'))
    fireEvent.drop(cell('10:00', 0))

    expect((await screen.findByRole('alert')).textContent).toContain('That will not do.')
  })

  it('surfaces a failure to load', async () => {
    renderPage(stub({ getSessions: () => Promise.reject(new Error('nope')) }))

    expect((await screen.findByRole('alert')).textContent).toContain('Could not load')
  })

  it('does not fetch for someone who is not a member', async () => {
    const getSessions = vi.fn<ScheduleApi['getSessions']>(() => Promise.resolve({ sessions: [] }))
    renderPage(stub({ getSessions }), { status: 'signed-out' })

    expect(screen.getByText(/for members/)).toBeTruthy()
    expect(getSessions).not.toHaveBeenCalled()
  })
})
