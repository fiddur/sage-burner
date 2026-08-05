import type { Event, MyBurn, Place, Session } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { ScheduleApi } from './Schedule.tsx'

import { apiError } from '../api/client.ts'
import { BurnProvider } from '../burn.tsx'
import { ViewerProvider } from '../viewer.tsx'
import { Schedule } from './Schedule.tsx'

afterEach(cleanup)

const MEMBER: Viewer = { status: 'signed-in', account: { id: 'a-1', name: null, roles: ['member'] } }

const BURN: Event = {
  id: 'e-1',
  name: 'Summer burn',
  slug: 'summer-2026',
  start_date: '2026-08-01',
  end_date: '2026-08-02',
  start_time: '00:00',
  end_time: '23:59',
  welcome_markdown: '',
  member_cap: 42,
  created_at: '2026-07-02T00:00:00.000Z',
}

const TEMPLE: Place = { id: 'p-1', event_id: 'e-1', order: 0, name: 'Temple', emoji: '🛕', color: 'yellow' }
const SAUNA: Place = { id: 'p-2', event_id: 'e-1', order: 1, name: 'Sauna', emoji: '🥵', color: 'red' }

const aDream = (over: Partial<Session> & Pick<Session, 'id' | 'title'>): Session => ({
  event_id: 'e-1',
  facilitator_account_id: null,
  description: '',
  repeatable: false,
  time_slot_start: null,
  time_slot_end: null,
  place_id: null,
  helpers: [],
  support_count: 0,
  supported_by_me: false,
  ...over,
})

const stub = (
  over: Partial<ScheduleApi> = {},
  sessions: Session[] = [],
  places: Place[] = [TEMPLE, SAUNA],
): ScheduleApi => ({
  getPlaces: () => Promise.resolve({ places }),
  getSessions: () => Promise.resolve({ sessions }),
  updateSession: () => Promise.reject(new Error('updateSession is not stubbed here')),
  offerSession: () => Promise.reject(new Error('offerSession is not stubbed here')),
  getEventAttendees: () => Promise.resolve({ attendees: [{ account_id: 'a-1', name: 'Ada Lovelace' }] }),
  helpWithSession: () => Promise.reject(new Error('helpWithSession is not stubbed here')),
  stopHelpingWithSession: () => Promise.reject(new Error('stopHelpingWithSession is not stubbed here')),
  supportSession: () => Promise.reject(new Error('supportSession is not stubbed here')),
  withdrawSupportForSession: () => Promise.reject(new Error('withdrawSupportForSession is not stubbed here')),
  ...over,
})

/** The selector's view of the same burn, so the two cannot describe different ones. */
const CHOSEN: MyBurn = { event: BURN, attendance: null }

// `null`, not `undefined`: passing `undefined` to a parameter with a default gets
// the default, so "no burn" written that way silently rendered the usual one.
const renderPage = (api: ScheduleApi, viewer: Viewer = MEMBER, burn: MyBurn | null = CHOSEN) =>
  render(
    <ViewerProvider viewer={viewer}>
      <BurnProvider
        value={{ status: 'ready', burns: burn === null ? [] : [burn], selected: burn ?? undefined }}
      >
        <Schedule api={api} />
      </BurnProvider>
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
    // Two whole days, 24 rows each. The burn's own hours decide this now — an
    // organiser who says 12:00 to 12:00 gets a grid that starts and stops there.
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

  it("keeps a dream scheduled outside the burn's hours visible", async () => {
    // It has both a place and a time, so it is not \u201cunplaced\u201d; without a row
    // for it, and without the pool being derived from what the grid draws, it
    // would render nowhere at all.
    renderPage(
      stub({}, [
        aDream({
          id: 's-1',
          title: 'Last dance',
          place_id: 'p-1',
          time_slot_start: '2026-08-02T23:00:00.000Z',
          time_slot_end: '2026-08-03T01:00:00.000Z',
        }),
      ]),
    )

    await screen.findByRole('columnheader', { name: /Temple/ })

    expect(document.body.textContent).toContain('Last dance')
  })

  it('pools a dream timed outside the grid entirely, rather than losing it', async () => {
    // It has a place and a time, so guessing \u201cunplaced means a null field\u201d would
    // leave it in neither the grid nor the pool. The pool is derived from what
    // the grid actually draws so that cannot happen, whatever the date.
    renderPage(
      stub({}, [
        aDream({
          id: 's-1',
          title: 'Wrong week',
          place_id: 'p-1',
          time_slot_start: '2026-08-20T10:00:00.000Z',
          time_slot_end: '2026-08-20T11:00:00.000Z',
        }),
      ]),
    )

    expect((await screen.findByRole('complementary')).textContent).toContain('Wrong week')
  })

  it('keeps the length of a dream that already had one when it is moved', async () => {
    // Re-dragging a two-hour session into another lane must not silently make it
    // an hour long.
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
          time_slot_end: '2026-08-01T11:00:00.000Z',
        }),
      ]),
    )

    fireEvent.dragStart(await screen.findByLabelText('Move Cacao ceremony'))
    fireEvent.drop(cell('14:00', 1))

    await waitFor(() =>
      expect(updateSession).toHaveBeenCalledWith('s-1', {
        place_id: 'p-2',
        time_slot_start: '2026-08-01T12:00:00.000Z',
        time_slot_end: '2026-08-01T15:00:00.000Z',
      }),
    )
  })

  it('draws a three-hour dream across three rows, not one', async () => {
    // The bug as reported: a dream edited to 18–21 still read as 18–19, because
    // the cell was drawn in the start row and nothing spanned.
    renderPage(
      stub({}, [
        aDream({
          id: 's-1',
          title: 'Welcome Sauna Sharing',
          place_id: 'p-1',
          time_slot_start: '2026-08-01T16:00:00.000Z',
          time_slot_end: '2026-08-01T19:00:00.000Z',
        }),
      ]),
    )

    await screen.findByRole('columnheader', { name: /Temple/ })
    const anchor = cell('18:00', 0)

    expect(anchor.getAttribute('rowspan')).toBe('3')
    expect(anchor.textContent).toContain('Welcome Sauna Sharing')
  })

  it('renders no cell under a spanning dream, so the lane does not shift', async () => {
    // `rowSpan` already occupies those rows; a cell of their own would push every
    // later lane one column across.
    renderPage(
      stub({}, [
        aDream({
          id: 's-1',
          title: 'Long one',
          place_id: 'p-1',
          time_slot_start: '2026-08-01T16:00:00.000Z',
          time_slot_end: '2026-08-01T19:00:00.000Z',
        }),
      ]),
    )

    await screen.findByRole('columnheader', { name: /Temple/ })
    const rowOf = (labelText: string) =>
      [...document.querySelectorAll('.schedule-grid th[scope="row"]')].find(
        (node) => node.textContent === labelText,
      )?.parentElement

    // Two lanes: an ordinary row has two cells, a covered one only the Sauna lane.
    expect(rowOf('17:00')?.querySelectorAll('td')).toHaveLength(2)
    expect(rowOf('19:00')?.querySelectorAll('td')).toHaveLength(1)
    expect(rowOf('20:00')?.querySelectorAll('td')).toHaveLength(1)
    expect(rowOf('21:00')?.querySelectorAll('td')).toHaveLength(2)
  })

  it('writes the times on the chip, so the length is readable without counting rows', async () => {
    renderPage(
      stub({}, [
        aDream({
          id: 's-1',
          title: 'Welcome Sauna Sharing',
          place_id: 'p-1',
          time_slot_start: '2026-08-01T16:00:00.000Z',
          time_slot_end: '2026-08-01T19:00:00.000Z',
        }),
      ]),
    )

    expect((await screen.findByLabelText('Move Welcome Sauna Sharing')).textContent).toContain('18:00–21:00')
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

  it('copies a repeatable dream into the grid, leaving the original in the pool', async () => {
    const offerSession = vi.fn<ScheduleApi['offerSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-2', title: 'Check in' }) }),
    )
    const updateSession = vi.fn<ScheduleApi['updateSession']>(() =>
      Promise.reject(new Error('a repeatable dream is copied, not moved')),
    )
    renderPage(
      stub({ offerSession, updateSession }, [
        aDream({ id: 's-1', title: 'Check in', description: 'Every morning.', repeatable: true }),
      ]),
    )

    fireEvent.dragStart(await screen.findByLabelText('Move Check in'))
    fireEvent.drop(cell('10:00', 0))

    await waitFor(() =>
      expect(offerSession).toHaveBeenCalledWith('e-1', {
        title: 'Check in',
        description: 'Every morning.',
        facilitator_account_id: null,
        repeatable: false,
        place_id: 'p-1',
        time_slot_start: '2026-08-01T08:00:00.000Z',
        time_slot_end: '2026-08-01T09:00:00.000Z',
      }),
    )
    expect(updateSession).not.toHaveBeenCalled()
  })

  it('moves an ordinary dream rather than copying it', async () => {
    // The passing sibling. Without it, a `dropInto` that copied unconditionally
    // would satisfy the test above and quietly duplicate every dream anyone moved.
    const offerSession = vi.fn<ScheduleApi['offerSession']>(() =>
      Promise.reject(new Error('an ordinary dream is moved, not copied')),
    )
    const updateSession = vi.fn<ScheduleApi['updateSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'Sunrise yoga' }) }),
    )
    renderPage(stub({ offerSession, updateSession }, [aDream({ id: 's-1', title: 'Sunrise yoga' })]))

    fireEvent.dragStart(await screen.findByLabelText('Move Sunrise yoga'))
    fireEvent.drop(cell('10:00', 0))

    await waitFor(() => expect(updateSession).toHaveBeenCalled())
    expect(offerSession).not.toHaveBeenCalled()
  })

  it('marks a repeatable dream, so the pool says which ones stay', async () => {
    renderPage(
      stub({}, [
        aDream({ id: 's-1', title: 'Check in', repeatable: true }),
        aDream({ id: 's-2', title: 'Sunrise yoga' }),
      ]),
    )

    const pool = await screen.findByRole('complementary')
    const marked = [...pool.querySelectorAll('.dream-chip')].filter((chip) => chip.textContent?.includes('↻'))

    expect(marked).toHaveLength(1)
    expect(marked[0]?.textContent).toContain('Check in')
    expect(pool.textContent).toContain('Can be planned more than once')
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

  it('writes to the drag data store, which Firefox needs to start a drag at all', async () => {
    const setData = vi.fn()
    renderPage(stub({}, [aDream({ id: 's-1', title: 'Sunrise yoga' })]))

    fireEvent.dragStart(await screen.findByLabelText('Move Sunrise yoga'), { dataTransfer: { setData } })

    expect(setData).toHaveBeenCalledWith('text/plain', 's-1')
  })

  it('shows the facilitator as initials, with the name for a reader', async () => {
    renderPage(
      stub({}, [
        aDream({
          id: 's-1',
          title: 'Cacao ceremony',
          place_id: 'p-2',
          facilitator_account_id: 'a-1',
          time_slot_start: '2026-08-01T08:00:00.000Z',
          time_slot_end: '2026-08-01T09:00:00.000Z',
        }),
      ]),
    )

    await screen.findByText('Cacao ceremony')

    // The letters are `aria-hidden`; the name is what a screen reader gets, and the
    // `title` is what a pointer gets. "AL" alone tells neither of them anything.
    expect(screen.getByText('AL')).toBeTruthy()
    expect(screen.getByText(/Facilitated by Ada Lovelace/)).toBeTruthy()
  })

  it('shows no circle at all when nobody is facilitating', async () => {
    // The passing sibling, and the case a dream starts in: an empty circle would
    // read as somebody whose name is missing.
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

    await screen.findByText('Cacao ceremony')

    expect(screen.queryByText(/Facilitated by/)).toBeNull()
  })

  it('wraps a placed dream in the stack the height rule needs', async () => {
    // The only half of this a suite can reach. happy-dom computes no layout, so
    // nothing here can assert a rendered height — but the CSS that makes a block as
    // tall as its hours hangs off this element being inside the spanning cell, and
    // that is checkable. Without it a three-hour dream draws about an hour and a
    // half, which is what #198 part 7 was.
    renderPage(
      stub({}, [
        aDream({
          id: 's-1',
          title: 'Cacao ceremony',
          place_id: 'p-2',
          time_slot_start: '2026-08-01T08:00:00.000Z',
          time_slot_end: '2026-08-01T10:00:00.000Z',
        }),
      ]),
    )

    const chip = await screen.findByText('Cacao ceremony')
    const stack = chip.closest('.dream-stack')

    expect(stack).not.toBeNull()
    expect(stack?.closest('td')?.getAttribute('rowspan')).toBe('2')
  })

  it('says so when no burn is open, rather than drawing an empty grid', async () => {
    renderPage(stub({}, [], [TEMPLE]), MEMBER, null)

    expect(await screen.findByText(/not coming to a burn yet/)).toBeTruthy()
    expect(document.querySelector('.schedule-grid')).toBeNull()
  })

  it('points at the places page when there are no lanes yet', async () => {
    renderPage(stub({}, [], []))

    expect(await screen.findByRole('link', { name: 'Places' })).toBeTruthy()
    expect(document.querySelector('.schedule-grid')).toBeNull()
  })

  it('opens the details when a chip is clicked', async () => {
    renderPage(stub({}, [aDream({ id: 's-1', title: 'Cacao ceremony', description: 'Bring a cup.' })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Open Cacao ceremony' }))

    const panel = await screen.findByRole('dialog', { name: 'Cacao ceremony' })
    expect(panel.textContent).toContain('Bring a cup.')
  })

  it('does not open the details on the click a drag leaves behind', async () => {
    // Dragging a dream across the grid must not also open a panel over where it landed.
    renderPage(stub({}, [aDream({ id: 's-1', title: 'Cacao ceremony' })]))

    const chip = await screen.findByLabelText('Move Cacao ceremony')
    fireEvent.mouseDown(chip)
    fireEvent.dragStart(chip)
    fireEvent.click(chip)

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens on the next ordinary click, so a drag suppresses one click and not all of them', async () => {
    // The passing sibling. A flag set by the drag and never cleared would satisfy the
    // test above by never opening the panel again at all.
    renderPage(stub({}, [aDream({ id: 's-1', title: 'Cacao ceremony' })]))

    const chip = await screen.findByLabelText('Move Cacao ceremony')
    fireEvent.mouseDown(chip)
    fireEvent.dragStart(chip)
    fireEvent.click(chip)

    fireEvent.mouseDown(chip)
    fireEvent.click(chip)

    expect(await screen.findByRole('dialog', { name: 'Cacao ceremony' })).toBeTruthy()
  })

  it('closes the details again', async () => {
    renderPage(stub({}, [aDream({ id: 's-1', title: 'Cacao ceremony' })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Open Cacao ceremony' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on Escape and on the backdrop, but not on the panel itself', async () => {
    renderPage(stub({}, [aDream({ id: 's-1', title: 'Cacao ceremony' })]))
    const open = async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Open Cacao ceremony' }))
      return screen.findByRole('dialog', { name: 'Cacao ceremony' })
    }

    fireEvent.keyDown(await open(), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    // Without the guard, reading the description would close the thing you opened.
    fireEvent.click(await open())
    expect(screen.queryByRole('dialog')).toBeTruthy()

    const backdrop = document.querySelector('.dream-modal')
    if (backdrop === null) throw new Error('the panel is open, so there is a backdrop')
    fireEvent.click(backdrop)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('gives a dream a heart from the chip, without opening anything', async () => {
    const supportSession = vi.fn<ScheduleApi['supportSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'Cacao ceremony' }) }),
    )
    renderPage(stub({ supportSession }, [aDream({ id: 's-1', title: 'Cacao ceremony' })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Show support for Cacao ceremony' }))

    await waitFor(() => expect(supportSession).toHaveBeenCalledWith('s-1'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('takes the heart back when it is already mine', async () => {
    const withdrawSupportForSession = vi.fn<ScheduleApi['withdrawSupportForSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'Cacao ceremony' }) }),
    )
    renderPage(
      stub({ withdrawSupportForSession }, [
        aDream({ id: 's-1', title: 'Cacao ceremony', supported_by_me: true, support_count: 3 }),
      ]),
    )

    const heart = await screen.findByRole('button', { name: 'Take back your support for Cacao ceremony' })

    expect(heart.getAttribute('aria-pressed')).toBe('true')
    expect(heart.textContent).toContain('3')

    fireEvent.click(heart)

    await waitFor(() => expect(withdrawSupportForSession).toHaveBeenCalledWith('s-1'))
  })

  it('shows the heart on an unplaced dream too, since a dream wants support before it has a time', async () => {
    renderPage(stub({}, [aDream({ id: 's-1', title: 'Sunrise yoga', support_count: 2 })]))

    const pool = await screen.findByRole('complementary')

    expect(pool.querySelector('.dream-heart')?.textContent).toContain('2')
  })

  it('offers to help from the details, and to stop when already helping', async () => {
    const helpWithSession = vi.fn<ScheduleApi['helpWithSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'Cacao ceremony' }) }),
    )
    renderPage(stub({ helpWithSession }, [aDream({ id: 's-1', title: 'Cacao ceremony' })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Open Cacao ceremony' }))
    fireEvent.click(screen.getByRole('button', { name: 'I want to help out' }))

    await waitFor(() => expect(helpWithSession).toHaveBeenCalledWith('s-1'))
  })

  it('says “I cannot help after all” to somebody already on the list', async () => {
    const stopHelpingWithSession = vi.fn<ScheduleApi['stopHelpingWithSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'Cacao ceremony' }) }),
    )
    renderPage(
      stub({ stopHelpingWithSession }, [
        aDream({
          id: 's-1',
          title: 'Cacao ceremony',
          // 'a-1' is the viewer, so the button is the other way round for them.
          helpers: [{ account_id: 'a-1', name: 'Ada Lovelace' }],
        }),
      ]),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Open Cacao ceremony' }))
    expect(screen.getByRole('dialog').textContent).toContain('Ada Lovelace')

    fireEvent.click(screen.getByRole('button', { name: 'I cannot help after all' }))

    await waitFor(() => expect(stopHelpingWithSession).toHaveBeenCalledWith('s-1'))
  })

  it('offers to help when somebody else is on the list, rather than reading the list as mine', async () => {
    // The passing sibling for the button above. A `helpers.length > 0` test would
    // satisfy that one and offer to *stop* helping to somebody who never started.
    renderPage(
      stub({}, [
        aDream({
          id: 's-1',
          title: 'Cacao ceremony',
          helpers: [{ account_id: 'a-9', name: 'Someone else' }],
        }),
      ]),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Open Cacao ceremony' }))

    expect(screen.getByRole('button', { name: 'I want to help out' })).toBeTruthy()
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
