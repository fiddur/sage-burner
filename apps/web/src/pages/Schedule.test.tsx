import type { Event, Meal, MyBurn, Place, Session } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { ScheduleApi } from './Schedule.tsx'

import { apiError } from '../api/client.ts'
import { BurnProvider } from '../burn.tsx'
import { ViewerProvider } from '../viewer.tsx'
import { Schedule } from './Schedule.tsx'

afterEach(cleanup)

const MEMBER: Viewer = {
  status: 'signed-in',
  account: { id: 'a-1', name: null, avatar: null, roles: ['member'] },
}

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
  getEventAttendees: () =>
    Promise.resolve({
      attendees: [
        { account_id: 'a-1', name: 'Ada Lovelace', avatar: null },
        // A second, so a control offering everybody can be told from one offering only
        // whoever is already on the sitting.
        { account_id: 'a-2', name: 'Bea', avatar: null },
      ],
    }),
  helpWithSession: () => Promise.reject(new Error('helpWithSession is not stubbed here')),
  stopHelpingWithSession: () => Promise.reject(new Error('stopHelpingWithSession is not stubbed here')),
  supportSession: () => Promise.reject(new Error('supportSession is not stubbed here')),
  withdrawSupportForSession: () => Promise.reject(new Error('withdrawSupportForSession is not stubbed here')),
  withdrawSession: () => Promise.reject(new Error('withdrawSession is not stubbed here')),
  getMeals: () => Promise.resolve({ intro_markdown: '', slots: [], meals: [] }),
  updateMeal: () => Promise.reject(new Error('updateMeal is not stubbed here')),
  setMealLead: () => Promise.reject(new Error('setMealLead is not stubbed here')),
  joinMealCrew: () => Promise.reject(new Error('joinMealCrew is not stubbed here')),
  leaveMealCrew: () => Promise.reject(new Error('leaveMealCrew is not stubbed here')),
  setMealIdea: () => Promise.reject(new Error('setMealIdea is not stubbed here')),
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

/**
 * The cell for a given hour row and place column.
 *
 * `endsWith` rather than equality, because a row that starts a day carries the day
 * above the time — `Sat 1` then `00:00` — so its `textContent` is not the label
 * alone. Every label is a fixed-width `HH:MM`, so on a row without a day this is
 * still equality.
 */
const cell = (rowLabel: string, column: number) => {
  const header = [...document.querySelectorAll('.schedule-grid th[scope="row"]')].find((node) =>
    node.textContent?.endsWith(rowLabel),
  )
  const cells = header?.parentElement?.querySelectorAll('td')

  if (cells?.[column] === undefined) throw new Error(`no cell at ${rowLabel} column ${column}`)

  return cells[column]
}

describe('the time column', () => {
  it('names the day at the top and at each midnight, and nowhere else', async () => {
    // The burn runs 2026-08-01 into 2026-08-02 — a Saturday into a Sunday. The label
    // used to spell out `2026-08-01 00:00`, which is what made this column sixteen
    // characters wide for the sake of two rows in forty-eight.
    renderPage(stub())

    await screen.findByRole('columnheader', { name: /Temple/ })
    const days = [...document.querySelectorAll('.schedule-day')].map((node) => node.textContent)

    expect(days).toEqual(['Sat 1', 'Sun 2'])
  })

  it('keeps the hour on a row that does not start a day', async () => {
    renderPage(stub())

    await screen.findByRole('columnheader', { name: /Temple/ })
    const headers = [...document.querySelectorAll('.schedule-grid th[scope="row"]')]
    const oneAm = headers.find((node) => node.textContent === '01:00')

    // Exactly the time, with no day smuggled in: the passing sibling to the test
    // above, and the one that would fail if every row claimed to start a day.
    expect(oneAm).toBeTruthy()
    expect(oneAm?.querySelector('.schedule-day')).toBeNull()
  })
})

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

  it('closes on Escape after something in the panel has been clicked', async () => {
    // The bug: the handler was on the panel and waited for the key to bubble from
    // inside it. Clicking anything disables it for the length of the write, and a
    // disabled button drops focus to `<body>` — so Escape stopped working the moment
    // you did anything, which is when you most want it.
    const supportSession = vi.fn<ScheduleApi['supportSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'Cacao ceremony' }) }),
    )
    renderPage(stub({ supportSession }, [aDream({ id: 's-1', title: 'Cacao ceremony' })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Open Cacao ceremony' }))
    const panel = await screen.findByRole('dialog', { name: 'Cacao ceremony' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Show support' }))
    await waitFor(() => expect(supportSession).toHaveBeenCalled())

    fireEvent.keyDown(document.body, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('leaves the heart unadorned, since it is a control and not a link', async () => {
    renderPage(stub({}, [aDream({ id: 's-1', title: 'Cacao ceremony' })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Open Cacao ceremony' }))
    const panel = await screen.findByRole('dialog', { name: 'Cacao ceremony' })

    expect(within(panel).getByRole('button', { name: 'Show support' }).className).not.toContain('link-button')
  })

  it('lets go of the chip when a resize pointer is cancelled', async () => {
    // Without `onPointerCancel` the ref stays set and `onDragStart` goes on
    // cancelling every drag of this chip, so it can never be moved again.
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

    const handle = await screen.findByRole('button', { name: 'Change how long Cacao ceremony is' })
    fireEvent.pointerDown(handle, { clientY: 100 })
    fireEvent.pointerCancel(handle)

    fireEvent.dragStart(screen.getByLabelText('Move Cacao ceremony'))
    fireEvent.drop(cell('14:00', 1))

    await waitFor(() => expect(updateSession).toHaveBeenCalled())
  })

  it('gives a heart from the details too, and says how many want it', async () => {
    const supportSession = vi.fn<ScheduleApi['supportSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'Cacao ceremony' }) }),
    )
    renderPage(stub({ supportSession }, [aDream({ id: 's-1', title: 'Cacao ceremony', support_count: 4 })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Open Cacao ceremony' }))
    const panel = await screen.findByRole('dialog', { name: 'Cacao ceremony' })
    expect(panel.textContent).toContain('4 people want this')

    fireEvent.click(within(panel).getByRole('button', { name: 'Show support' }))

    await waitFor(() => expect(supportSession).toHaveBeenCalledWith('s-1'))
  })

  it('withdraws a dream from the dialog, but only after asking', async () => {
    const withdrawSession = vi.fn<ScheduleApi['withdrawSession']>(() => Promise.resolve(undefined))
    renderPage(stub({ withdrawSession }, [aDream({ id: 's-1', title: 'Cacao ceremony' })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Open Cacao ceremony' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw Cacao ceremony' }))

    // The first click asks; nothing has gone yet.
    expect(withdrawSession).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Really withdraw Cacao ceremony' }))

    await waitFor(() => expect(withdrawSession).toHaveBeenCalledWith('s-1'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('keeps the dream when the confirmation is declined', async () => {
    const withdrawSession = vi.fn<ScheduleApi['withdrawSession']>(() => Promise.resolve(undefined))
    renderPage(stub({ withdrawSession }, [aDream({ id: 's-1', title: 'Cacao ceremony' })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Open Cacao ceremony' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw Cacao ceremony' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))

    expect(withdrawSession).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('offers the withdrawal on an unplaced dream too', async () => {
    renderPage(stub({}, [aDream({ id: 's-1', title: 'Sunrise yoga' })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Open Sunrise yoga' }))

    expect(await screen.findByRole('button', { name: 'Withdraw Sunrise yoga' })).toBeTruthy()
  })

  it('offers to help from the details, and to stop when already helping', async () => {
    const helpWithSession = vi.fn<ScheduleApi['helpWithSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'Cacao ceremony' }) }),
    )
    renderPage(stub({ helpWithSession }, [aDream({ id: 's-1', title: 'Cacao ceremony' })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Open Cacao ceremony' }))
    fireEvent.click(screen.getByRole('button', { name: 'I want to help out' }))

    await waitFor(() => expect(helpWithSession).toHaveBeenCalledWith('s-1', { account_id: 'a-1' }))
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

    await waitFor(() => expect(stopHelpingWithSession).toHaveBeenCalledWith('s-1', 'a-1'))
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

  it('lengthens and shortens a placed dream from the keyboard', async () => {
    // The pointer half of the gesture cannot be tested here — happy-dom computes no
    // layout, so every row is nought pixels tall. `rowsDragged` and `resizedEnd`
    // carry that; this is the route somebody without a mouse takes.
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

    const handle = await screen.findByRole('button', { name: 'Change how long Cacao ceremony is' })
    fireEvent.keyDown(handle, { key: 'ArrowDown' })

    await waitFor(() =>
      expect(updateSession).toHaveBeenCalledWith('s-1', { time_slot_end: '2026-08-01T10:00:00.000Z' }),
    )

    updateSession.mockClear()
    fireEvent.keyDown(handle, { key: 'ArrowUp' })

    // Already an hour, so shortening it changes nothing and sends nothing.
    await waitFor(() => expect(updateSession).not.toHaveBeenCalled())
  })

  it('shortens a longer one, so ArrowUp is not simply ignored', async () => {
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

    fireEvent.keyDown(await screen.findByRole('button', { name: 'Change how long Cacao ceremony is' }), {
      key: 'ArrowUp',
    })

    await waitFor(() =>
      expect(updateSession).toHaveBeenCalledWith('s-1', { time_slot_end: '2026-08-01T10:00:00.000Z' }),
    )
  })

  it('offers no handle in the pool, where there are no rows to pull against', async () => {
    renderPage(stub({}, [aDream({ id: 's-1', title: 'Sunrise yoga' })]))

    await screen.findByRole('complementary')

    expect(screen.queryByRole('button', { name: 'Change how long Sunrise yoga is' })).toBeNull()
  })

  it('does not drag the dream away when the handle is what was grabbed', async () => {
    // `draggable` is on the chip, so without the guard a resize would also pick the
    // whole dream up and drop it in whatever lane the pointer ended over.
    // Asserted through the drop rather than through `preventDefault`: the
    // `dragstart` testing-library builds is not cancelable, so its return value says
    // nothing here even though a browser's does.
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

    const handle = await screen.findByRole('button', { name: 'Change how long Cacao ceremony is' })
    fireEvent.pointerDown(handle, { clientY: 100 })
    fireEvent.dragStart(screen.getByLabelText('Move Cacao ceremony'))
    fireEvent.drop(cell('14:00', 1))

    expect(updateSession).not.toHaveBeenCalled()
  })

  it('starts an ordinary drag when the handle was not grabbed', async () => {
    // The passing sibling: a guard that always prevented the default would satisfy
    // the test above and make the grid undraggable.
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
    fireEvent.drop(cell('14:00', 1))

    await waitFor(() => expect(updateSession).toHaveBeenCalled())
  })

  it('edits a dream in the dialog, without going to the Dreams page', async () => {
    const updateSession = vi.fn<ScheduleApi['updateSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'Renamed' }) }),
    )
    renderPage(stub({ updateSession }, [aDream({ id: 's-1', title: 'Cacao ceremony' })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Open Cacao ceremony' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Cacao ceremony' }))
    fireEvent.input(screen.getByLabelText('Title of Cacao ceremony'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    // Only what changed, the same rule the Dreams page follows.
    await waitFor(() => expect(updateSession).toHaveBeenCalledWith('s-1', { title: 'Renamed' }))
  })

  it('offers a dream from the pool, with nowhere and no time', async () => {
    const offerSession = vi.fn<ScheduleApi['offerSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-2', title: 'Check in' }) }),
    )
    renderPage(stub({ offerSession }))

    fireEvent.click(await screen.findByRole('button', { name: 'Offer a dream' }))
    fireEvent.input(screen.getByLabelText('Title of the new dream'), { target: { value: '  Check in  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Offer it' }))

    await waitFor(() =>
      expect(offerSession).toHaveBeenCalledWith('e-1', {
        title: 'Check in',
        description: '',
        place_id: null,
        time_slot_start: null,
        time_slot_end: null,
        facilitator_account_id: null,
        repeatable: false,
      }),
    )
  })

  it('offers a dream in the hour and the lane that were clicked', async () => {
    // What a calendar does. The slot is prefilled from the cell, so the whole body
    // is sent rather than a diff — a prefill diffed against itself is no change.
    const offerSession = vi.fn<ScheduleApi['offerSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-2', title: 'Sunrise yoga' }) }),
    )
    renderPage(stub({ offerSession }))

    await screen.findByRole('columnheader', { name: /Sauna/ })
    fireEvent.click(cell('10:00', 1))

    fireEvent.input(await screen.findByLabelText('Title of the new dream'), {
      target: { value: 'Sunrise yoga' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Offer it' }))

    await waitFor(() =>
      expect(offerSession).toHaveBeenCalledWith('e-1', {
        title: 'Sunrise yoga',
        description: '',
        place_id: 'p-2',
        time_slot_start: '2026-08-01T08:00:00.000Z',
        time_slot_end: '2026-08-01T09:00:00.000Z',
        facilitator_account_id: null,
        repeatable: false,
      }),
    )
  })

  it('offers nothing on an hour a dream already fills', async () => {
    // The passing sibling for the cell click, and the reason it tests `empty` rather
    // than any cell: a chip's click bubbles to the cell it sits in, so without the
    // check, opening a dream would also open the offer panel on top of it.
    const occupied = aDream({
      id: 's-1',
      title: 'Cacao ceremony',
      place_id: 'p-2',
      time_slot_start: '2026-08-01T08:00:00.000Z',
      time_slot_end: '2026-08-01T09:00:00.000Z',
    })
    renderPage(stub({}, [occupied]))

    await screen.findByRole('columnheader', { name: /Sauna/ })
    fireEvent.click(cell('10:00', 1))

    expect(screen.queryByLabelText('Title of the new dream')).toBeNull()

    // …and the chip inside it still opens the dream itself.
    fireEvent.click(screen.getByRole('button', { name: 'Open Cacao ceremony' }))

    expect(await screen.findByRole('dialog', { name: 'Cacao ceremony' })).toBeTruthy()
    expect(screen.queryByLabelText('Title of the new dream')).toBeNull()
  })

  it('will not offer a nameless dream', async () => {
    const offerSession = vi.fn<ScheduleApi['offerSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-2', title: 'x' }) }),
    )
    renderPage(stub({ offerSession }))

    fireEvent.click(await screen.findByRole('button', { name: 'Offer a dream' }))
    const offer = screen.getByRole('button', { name: 'Offer it' })

    expect(offer).toHaveProperty('disabled', true)

    fireEvent.click(offer)
    expect(offerSession).not.toHaveBeenCalled()
  })

  it('keeps a refused offer on screen, with everything that was typed', async () => {
    // The defect this replaced: the panel closed on the click, not on the write. A
    // start with no end is half a slot and a 400 from the schema — an ordinary
    // mistake, not a corner — and the title and description went with the panel.
    renderPage(
      stub({
        offerSession: () => Promise.reject(apiError(400, 'bad_request', 'That will not do.')),
      }),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Offer a dream' }))
    fireEvent.input(screen.getByLabelText('Title of the new dream'), { target: { value: 'Check in' } })
    fireEvent.click(screen.getByRole('button', { name: 'Offer it' }))

    expect((await screen.findByRole('alert')).textContent).toContain('That will not do.')
    expect(screen.getByRole('dialog', { name: 'Offer a dream' })).toBeTruthy()
    expect(screen.getByLabelText('Title of the new dream')).toHaveProperty('value', 'Check in')
  })

  it('closes the offer panel once the dream is actually offered', async () => {
    // The passing sibling: a panel that never closed would satisfy the test above.
    const offerSession = vi.fn<ScheduleApi['offerSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-2', title: 'Check in' }) }),
    )
    renderPage(stub({ offerSession }))

    fireEvent.click(await screen.findByRole('button', { name: 'Offer a dream' }))
    fireEvent.input(screen.getByLabelText('Title of the new dream'), { target: { value: 'Check in' } })
    fireEvent.click(screen.getByRole('button', { name: 'Offer it' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('stops asking to withdraw once you detour through edit', async () => {
    // #208: `confirming` is local state and nothing reset it, so 🗑️ then ✏️ then
    // Cancel came back to a "Withdraw it?" nobody was still asking — one click from
    // taking a dream off the grid, with its helpers and hearts.
    renderPage(stub({}, [aDream({ id: 's-1', title: 'Cacao ceremony' })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Open Cacao ceremony' }))
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw Cacao ceremony' }))
    expect(screen.getByRole('button', { name: 'Really withdraw Cacao ceremony' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Edit Cacao ceremony' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('button', { name: 'Really withdraw Cacao ceremony' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Withdraw Cacao ceremony' })).toBeTruthy()
  })

  it('still asks before withdrawing when nobody detoured anywhere', async () => {
    // The passing sibling: resetting on every render would pass the test above and
    // make the confirmation unreachable.
    const withdrawSession = vi.fn<ScheduleApi['withdrawSession']>(() => Promise.resolve(undefined))
    renderPage(stub({ withdrawSession }, [aDream({ id: 's-1', title: 'Cacao ceremony' })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Open Cacao ceremony' }))
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw Cacao ceremony' }))
    fireEvent.click(screen.getByRole('button', { name: 'Really withdraw Cacao ceremony' }))

    await waitFor(() => expect(withdrawSession).toHaveBeenCalledWith('s-1'))
  })

  it('keeps a refused edit open, with the edits still in the fields', async () => {
    renderPage(
      stub({ updateSession: () => Promise.reject(apiError(400, 'bad_request', 'That will not do.')) }, [
        aDream({ id: 's-1', title: 'Cacao ceremony' }),
      ]),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Open Cacao ceremony' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Cacao ceremony' }))
    fireEvent.input(screen.getByLabelText('Title of Cacao ceremony'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect((await screen.findByRole('alert')).textContent).toContain('That will not do.')
    expect(screen.getByLabelText('Title of Cacao ceremony')).toHaveProperty('value', 'Renamed')
  })

  it('leaves the form once a save lands, and says the right thing when one does not', async () => {
    // The passing sibling for the edit, and the message: a refused *edit* used to
    // report "Could not move that dream", because it went through the drag path.
    const updateSession = vi.fn<ScheduleApi['updateSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'Renamed' }) }),
    )
    renderPage(stub({ updateSession }, [aDream({ id: 's-1', title: 'Cacao ceremony' })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Open Cacao ceremony' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Cacao ceremony' }))
    fireEvent.input(screen.getByLabelText('Title of Cacao ceremony'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.queryByLabelText('Title of Cacao ceremony')).toBeNull())
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('reports a refused save as a save, not as a move', async () => {
    renderPage(
      stub({ updateSession: () => Promise.reject(new Error('nope')) }, [
        aDream({ id: 's-1', title: 'Cacao ceremony' }),
      ]),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Open Cacao ceremony' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Cacao ceremony' }))
    fireEvent.input(screen.getByLabelText('Title of Cacao ceremony'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Could not save that.')
  })

  it('shows the failure inside the panel, which covers the page it would print on', async () => {
    // `.dream-modal` is a fixed overlay, so the page-level error renders under it.
    renderPage(
      stub({ supportSession: () => Promise.reject(new Error('nope')) }, [
        aDream({ id: 's-1', title: 'Cacao ceremony' }),
      ]),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Open Cacao ceremony' }))
    const panel = await screen.findByRole('dialog', { name: 'Cacao ceremony' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Show support' }))

    const alert = await screen.findByRole('alert')

    expect(panel.contains(alert)).toBe(true)
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

describe('the kitchen', () => {
  const aMeal = (over: Partial<Meal> = {}): Meal => ({
    id: 'm-1',
    event_id: 'e-1',
    date: '2026-08-01',
    at: '18:00',
    label: 'Dinner',
    kind: 'meal',
    food_idea: '',
    lead: null,
    helpers: [],
    cleanup: [],
    ...over,
  })

  const withMeals = (meals: Meal[], over: Partial<ScheduleApi> = {}, sessions: Session[] = []) =>
    stub({ getMeals: () => Promise.resolve({ intro_markdown: '', slots: [], meals }), ...over }, sessions)

  it('draws no lane at all for a burn with no meals', async () => {
    renderPage(stub())

    await screen.findByRole('columnheader', { name: /Temple/ })

    expect(screen.queryByRole('columnheader', { name: /Kitchen/ })).toBeNull()
  })

  it('draws the cooking, the eating and the washing up', async () => {
    // 18:00 local in August is 16:00Z, so cooking runs 16:00–18:00 local.
    renderPage(withMeals([aMeal()]))

    expect(await screen.findByRole('columnheader', { name: /Kitchen/ })).toBeTruthy()
    expect(screen.getByLabelText('Move Cooking · Dinner')).toBeTruthy()
    expect(screen.getByLabelText('Move Dinner')).toBeTruthy()
    expect(screen.getByLabelText('Move Cleanup · Dinner')).toBeTruthy()
  })

  it('draws a chore as one block, with no cooking before it', async () => {
    renderPage(withMeals([aMeal({ label: 'Morning cleanup', at: '09:00', kind: 'chore' })]))

    expect(await screen.findByLabelText('Move Morning cleanup')).toBeTruthy()
    expect(screen.queryByLabelText(/Cooking/)).toBeNull()
  })

  it('opens the meal when a block is clicked', async () => {
    renderPage(withMeals([aMeal({ food_idea: 'Vegan bolognese' })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Open Cooking · Dinner' }))

    const panel = await screen.findByRole('dialog', { name: 'Dinner' })
    expect(within(panel).getByLabelText('Food idea for Dinner')).toHaveProperty('value', 'Vegan bolognese')
  })

  it('moves the meal so the block lands where it was dropped', async () => {
    // The cleanup block is the hour after, so dropping it on 15:00 is a 14:00 meal.
    const updateMeal = vi.fn<ScheduleApi['updateMeal']>(() => Promise.resolve({ meal: aMeal() }))
    renderPage(withMeals([aMeal()], { updateMeal }))

    fireEvent.dragStart(await screen.findByLabelText('Move Cleanup · Dinner'))
    fireEvent.drop(cell('15:00', 2))

    await waitFor(() => expect(updateMeal).toHaveBeenCalledWith('m-1', { date: '2026-08-01', at: '14:00' }))
  })

  it('will not take a dream into the kitchen', async () => {
    // The kitchen is for cooking, fetching food and washing up, and that is the whole
    // of it — so a dream dropped there must not land.
    const updateSession = vi.fn<ScheduleApi['updateSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'Sunrise yoga' }) }),
    )
    const updateMeal = vi.fn<ScheduleApi['updateMeal']>(() => Promise.resolve({ meal: aMeal() }))
    renderPage(
      withMeals([aMeal()], { updateSession, updateMeal }, [aDream({ id: 's-1', title: 'Sunrise yoga' })]),
    )

    fireEvent.dragStart(await screen.findByLabelText('Move Sunrise yoga'))
    fireEvent.drop(cell('10:00', 2))

    expect(updateSession).not.toHaveBeenCalled()
    expect(updateMeal).not.toHaveBeenCalled()
  })

  it('will not take a meal into a lane', async () => {
    // The other way round, and the passing sibling: a meal belongs to the kitchen.
    const updateMeal = vi.fn<ScheduleApi['updateMeal']>(() => Promise.resolve({ meal: aMeal() }))
    const updateSession = vi.fn<ScheduleApi['updateSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'x' }) }),
    )
    renderPage(withMeals([aMeal()], { updateMeal, updateSession }))

    fireEvent.dragStart(await screen.findByLabelText('Move Dinner'))
    fireEvent.drop(cell('10:00', 0))

    expect(updateMeal).not.toHaveBeenCalled()
    expect(updateSession).not.toHaveBeenCalled()
  })

  it('offers no resize handle on a meal, since its length is not its own', async () => {
    renderPage(withMeals([aMeal()]))

    await screen.findByLabelText('Move Dinner')

    expect(screen.queryByRole('button', { name: /Change how long/ })).toBeNull()
  })
})

describe('a drag that was abandoned', () => {
  const aMeal = (): Meal => ({
    id: 'm-1',
    event_id: 'e-1',
    date: '2026-08-01',
    at: '18:00',
    label: 'Dinner',
    kind: 'meal',
    food_idea: '',
    lead: null,
    helpers: [],
    cleanup: [],
  })

  const both = (over: Partial<ScheduleApi>) =>
    stub({ getMeals: () => Promise.resolve({ intro_markdown: '', slots: [], meals: [aMeal()] }), ...over }, [
      aDream({ id: 's-1', title: 'Sunrise yoga' }),
    ])

  /**
   * Dropping outside every target fires no `drop`, so an abandoned drag used to
   * leave its id behind. The next drop of the *other* kind then found it: a meal
   * dropped in a lane moved the abandoned dream instead, which is the kitchen's own
   * rule failing on the second drag rather than the first.
   */
  it('does not let an abandoned dream drag be moved by a later meal drop', async () => {
    const updateSession = vi.fn<ScheduleApi['updateSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'x' }) }),
    )
    const updateMeal = vi.fn<ScheduleApi['updateMeal']>(() => Promise.resolve({ meal: aMeal() }))
    renderPage(both({ updateSession, updateMeal }))

    fireEvent.dragStart(await screen.findByLabelText('Move Sunrise yoga'))
    fireEvent.dragStart(screen.getByLabelText('Move Dinner'))
    fireEvent.drop(cell('10:00', 0))

    expect(updateSession).not.toHaveBeenCalled()
    expect(updateMeal).not.toHaveBeenCalled()
  })

  it('does not let an abandoned meal drag be moved by a later dream drop', async () => {
    const updateSession = vi.fn<ScheduleApi['updateSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'x' }) }),
    )
    const updateMeal = vi.fn<ScheduleApi['updateMeal']>(() => Promise.resolve({ meal: aMeal() }))
    renderPage(both({ updateSession, updateMeal }))

    fireEvent.dragStart(await screen.findByLabelText('Move Dinner'))
    fireEvent.dragStart(screen.getByLabelText('Move Sunrise yoga'))
    fireEvent.drop(cell('10:00', 2))

    expect(updateMeal).not.toHaveBeenCalled()
    expect(updateSession).not.toHaveBeenCalled()
  })

  it('forgets a drag that ended without a drop', async () => {
    const updateSession = vi.fn<ScheduleApi['updateSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'x' }) }),
    )
    renderPage(both({ updateSession }))

    const chip = await screen.findByLabelText('Move Sunrise yoga')
    fireEvent.dragStart(chip)
    fireEvent.dragEnd(chip)
    fireEvent.drop(cell('10:00', 0))

    expect(updateSession).not.toHaveBeenCalled()
  })

  it('still moves a dream on an ordinary drag and drop', async () => {
    // The passing sibling for all three: clearing too eagerly would make the grid
    // undraggable while satisfying every test above.
    const updateSession = vi.fn<ScheduleApi['updateSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'x' }) }),
    )
    renderPage(both({ updateSession }))

    fireEvent.dragStart(await screen.findByLabelText('Move Sunrise yoga'))
    fireEvent.drop(cell('10:00', 0))

    await waitFor(() => expect(updateSession).toHaveBeenCalled())
  })

  it('still moves a meal on an ordinary drag and drop', async () => {
    const updateMeal = vi.fn<ScheduleApi['updateMeal']>(() => Promise.resolve({ meal: aMeal() }))
    renderPage(both({ updateMeal }))

    fireEvent.dragStart(await screen.findByLabelText('Move Dinner'))
    fireEvent.drop(cell('14:00', 2))

    await waitFor(() => expect(updateMeal).toHaveBeenCalledWith('m-1', { date: '2026-08-01', at: '14:00' }))
  })
})

describe('a chore in the kitchen', () => {
  const aChore = (): Meal => ({
    id: 'm-2',
    event_id: 'e-1',
    date: '2026-08-01',
    at: '09:00',
    label: 'Morning cleanup',
    kind: 'chore',
    food_idea: '',
    lead: null,
    helpers: [],
    cleanup: [],
  })

  it('asks for cleaners and nothing else', async () => {
    // Nothing is cooked at a morning cleanup, so it has nobody leading the cooking
    // and nobody helping with it. The API refuses both as well.
    renderPage(
      stub({ getMeals: () => Promise.resolve({ intro_markdown: '', slots: [], meals: [aChore()] }) }),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Open Morning cleanup' }))
    const panel = await screen.findByRole('dialog', { name: 'Morning cleanup' })

    expect(within(panel).queryByLabelText('Lead for Morning cleanup')).toBeNull()
    expect(within(panel).queryByText('Helping cook')).toBeNull()
    expect(within(panel).getByText('Washing up')).toBeTruthy()
  })

  it('still asks for all three on an ordinary meal', async () => {
    // The passing sibling: hiding them everywhere would satisfy the test above.
    const meal: Meal = { ...aChore(), id: 'm-1', label: 'Dinner', at: '18:00', kind: 'meal' }
    renderPage(stub({ getMeals: () => Promise.resolve({ intro_markdown: '', slots: [], meals: [meal] }) }))

    fireEvent.click(await screen.findByRole('button', { name: 'Open Dinner' }))
    const panel = await screen.findByRole('dialog', { name: 'Dinner' })

    expect(within(panel).getByLabelText('Lead for Dinner')).toBeTruthy()
    expect(within(panel).getByText('Helping cook')).toBeTruthy()
    expect(within(panel).getByText('Washing up')).toBeTruthy()
  })
})

describe('a chore’s lead, in the panel', () => {
  const stranded = (lead: { account_id: string; name: string } | null): Meal => ({
    id: 'm-3',
    event_id: 'e-1',
    date: '2026-08-01',
    at: '09:00',
    label: 'Morning cleanup',
    kind: 'chore',
    food_idea: '',
    lead,
    helpers: [],
    cleanup: [],
  })

  const withMeal = (meal: Meal) =>
    stub({ getMeals: () => Promise.resolve({ intro_markdown: '', slots: [], meals: [meal] }) })

  it('names whoever is on it, and offers nobody else', async () => {
    // Without an option of their own nothing matches the control's value and it draws
    // blank — vacant-looking while somebody is still on it.
    renderPage(withMeal(stranded({ account_id: 'a-1', name: 'Ada Lovelace' })))

    fireEvent.click(await screen.findByRole('button', { name: 'Open Morning cleanup' }))
    const select = await screen.findByLabelText('Lead for Morning cleanup')

    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Nobody yet',
      'Ada Lovelace',
    ])
    expect(select).toHaveProperty('value', 'a-1')
  })

  it('vacates it, which is the one thing the API allows here', async () => {
    const updateMeal = vi.fn<ScheduleApi['updateMeal']>(() => Promise.resolve({ meal: stranded(null) }))
    const setMealLead = vi.fn<ScheduleApi['setMealLead']>(() => Promise.resolve({ meal: stranded(null) }))
    renderPage(
      stub({
        getMeals: () =>
          Promise.resolve({
            intro_markdown: '',
            slots: [],
            meals: [stranded({ account_id: 'a-1', name: 'Ada Lovelace' })],
          }),
        setMealLead,
        updateMeal,
      }),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Open Morning cleanup' }))
    fireEvent.change(await screen.findByLabelText('Lead for Morning cleanup'), { target: { value: '' } })

    await waitFor(() => expect(setMealLead).toHaveBeenCalledWith('m-3', { account_id: null }))
  })

  it('offers no lead at all on a chore nobody leads', async () => {
    // The passing sibling: showing it whenever the kind is a chore would put back the
    // control whose only affirmative action the API refuses.
    renderPage(withMeal(stranded(null)))

    fireEvent.click(await screen.findByRole('button', { name: 'Open Morning cleanup' }))
    await screen.findByRole('dialog', { name: 'Morning cleanup' })

    expect(screen.queryByLabelText('Lead for Morning cleanup')).toBeNull()
  })
})
