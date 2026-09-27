import type { Attendance, MemberRosterEntry, MyBurn, MyBurnsResponse } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { LocationProvider } from 'preact-iso'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { YourBurnsApi } from './YourBurns.tsx'

import { apiError } from '../api/client.ts'
import { BurnProvider } from '../burn.tsx'
import { YourBurns } from './YourBurns.tsx'

afterEach(cleanup)

const anAttendance = (over: Partial<Attendance> = {}): Attendance => ({
  id: 'att-1',
  event_id: 'e-1',
  account_id: 'a-1',
  joined_at: '2026-07-01T00:00:00.000Z',
  arrival_date: null,
  departure_date: null,
  lodging_option_id: null,
  helping_option_ids: [],
  helping_other: null,
  notes: null,
  payment_status: 'unpaid',
  payment_date: null,
  ...over,
})

const aBurn = (id: string, name: string, attendance: Attendance | null = null): MyBurn => ({
  event: {
    id,
    name,
    slug: name.toLowerCase(),
    start_date: '2026-08-01',
    end_date: '2026-08-05',
    start_time: '16:00',
    end_time: '12:00',
  },
  attendance,
})

const stub = (over: Partial<YourBurnsApi> = {}, burns: MyBurnsResponse = { coming: [], past: [] }) => ({
  getMyBurns: () => Promise.resolve(burns),
  getEventOptions: () => Promise.resolve({ options: [] }),
  joinEvent: () => Promise.reject(new Error('joinEvent is not stubbed here')),
  leaveEvent: () => Promise.reject(new Error('leaveEvent is not stubbed here')),
  donateMyPlace: () => Promise.reject(new Error('donateMyPlace is not stubbed here')),
  updateMyStay: () => Promise.reject(new Error('updateMyStay is not stubbed here')),
  getMembers: () => Promise.reject(new Error('getMembers is not stubbed here')),
  transferMyPlace: () => Promise.reject(new Error('transferMyPlace is not stubbed here')),
  ...over,
})

describe('YourBurns', () => {
  it('offers to join a burn they have not said anything about', async () => {
    const joinEvent = vi.fn(() => Promise.resolve({ attendance: anAttendance() }))
    render(<YourBurns api={stub({ joinEvent }, { coming: [aBurn('e-1', 'Summer')], past: [] })} />)

    fireEvent.click(await screen.findByRole('button', { name: 'I am coming' }))

    await waitFor(() => expect(joinEvent).toHaveBeenCalledWith('e-1'))
  })

  it('names the burn each button belongs to, since there is more than one', async () => {
    const joinEvent = vi.fn(() => Promise.resolve({ attendance: anAttendance() }))
    render(
      <YourBurns
        api={stub({ joinEvent }, { coming: [aBurn('e-1', 'Summer'), aBurn('e-2', 'Winter')], past: [] })}
      />,
    )

    const buttons = await screen.findAllByRole('button', { name: 'I am coming' })
    fireEvent.click(buttons[1] ?? buttons[0]!)

    await waitFor(() => expect(joinEvent).toHaveBeenCalledWith('e-2'))
  })

  it('shows the stay form once they are coming, and asks for that burn’s lists', async () => {
    const getEventOptions = vi.fn(() => Promise.resolve({ options: [] }))
    render(
      <YourBurns
        api={stub({ getEventOptions }, { coming: [aBurn('e-1', 'Summer', anAttendance())], past: [] })}
      />,
    )

    expect(await screen.findByLabelText('Arriving')).toBeTruthy()
    expect(getEventOptions).toHaveBeenCalledWith('e-1', expect.anything())
  })

  it('asks for no lists at all for a burn they have not joined', async () => {
    const getEventOptions = vi.fn(() => Promise.resolve({ options: [] }))
    render(<YourBurns api={stub({ getEventOptions }, { coming: [aBurn('e-1', 'Summer')], past: [] })} />)

    await screen.findByRole('button', { name: 'I am coming' })
    expect(getEventOptions).not.toHaveBeenCalled()
  })

  it('points a refused withdrawal at the hand-over, rather than saying try again', async () => {
    const leaveEvent = vi.fn(() => Promise.reject(apiError(409, 'conflict', 'nope')))
    render(
      <YourBurns
        api={stub({ leaveEvent }, { coming: [aBurn('e-1', 'Summer', anAttendance())], past: [] })}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'I cannot come after all' }))
    fireEvent.click(screen.getByRole('button', { name: /^Really /u }))

    expect((await screen.findByRole('alert')).textContent).toContain('hand your place to somebody else')
  })

  it('says a burn is over rather than "try again" when joining it 404s', async () => {
    const joinEvent = vi.fn(() => Promise.reject(apiError(404, 'not_found', 'Not found.')))
    render(<YourBurns api={stub({ joinEvent }, { coming: [aBurn('e-1', 'Summer')], past: [] })} />)

    fireEvent.click(await screen.findByRole('button', { name: 'I am coming' }))

    expect((await screen.findByRole('alert')).textContent).toContain('That burn is over')
  })

  it('still falls back to try-again for a status that is not a refusal', async () => {
    const joinEvent = vi.fn(() => Promise.reject(apiError(500, 'internal', 'Boom.')))
    render(<YourBurns api={stub({ joinEvent }, { coming: [aBurn('e-1', 'Summer')], past: [] })} />)

    fireEvent.click(await screen.findByRole('button', { name: 'I am coming' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Please try again')
  })

  it('keeps past burns behind a disclosure', async () => {
    render(<YourBurns api={stub({}, { coming: [], past: [aBurn('e-0', 'Last summer', anAttendance())] })} />)

    const toggle = await screen.findByRole('button', { name: '…show past burns' })
    expect(screen.queryByText(/Last summer/)).toBeNull()

    fireEvent.click(toggle)

    expect(screen.getByText(/Last summer/)).toBeTruthy()
  })

  it('offers no disclosure when there is no history to hide', async () => {
    render(<YourBurns api={stub({}, { coming: [aBurn('e-1', 'Summer')], past: [] })} />)

    await screen.findByRole('button', { name: 'I am coming' })
    expect(screen.queryByRole('button', { name: '…show past burns' })).toBeNull()
  })

  it('says so when nothing is planned, rather than showing an empty page', async () => {
    render(<YourBurns api={stub()} />)

    expect(await screen.findByText(/no burn planned/)).toBeTruthy()
  })
})

describe('the bar’s list of burns', () => {
  const renderWithBurns = (api: YourBurnsApi, reload: () => void) =>
    render(
      <BurnProvider value={{ status: 'ready', burns: [], selected: undefined, reload }}>
        <YourBurns api={api} />
      </BurnProvider>,
    )

  it('is asked for again after joining one', async () => {
    const reload = vi.fn()
    const joinEvent = vi.fn<YourBurnsApi['joinEvent']>(() => Promise.resolve({ attendance: anAttendance() }))
    renderWithBurns(stub({ joinEvent }, { coming: [aBurn('e-1', 'Summer')], past: [] }), reload)

    fireEvent.click(await screen.findByRole('button', { name: 'I am coming' }))

    await waitFor(() => expect(joinEvent).toHaveBeenCalledWith('e-1'))
    expect(reload).toHaveBeenCalled()
  })

  it('is asked for again after withdrawing from one', async () => {
    const reload = vi.fn()
    const leaveEvent = vi.fn<YourBurnsApi['leaveEvent']>(() => Promise.resolve(undefined))
    renderWithBurns(
      stub({ leaveEvent }, { coming: [aBurn('e-1', 'Summer', anAttendance())], past: [] }),
      reload,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'I cannot come after all' }))
    fireEvent.click(screen.getByRole('button', { name: /^Really /u }))

    await waitFor(() => expect(leaveEvent).toHaveBeenCalledWith('e-1'))
    expect(reload).toHaveBeenCalled()
  })

  it('leaves it alone when the join was refused', async () => {
    const reload = vi.fn()
    renderWithBurns(
      stub(
        { joinEvent: () => Promise.reject(apiError(404, 'not_found', 'gone')) },
        { coming: [aBurn('e-1', 'Summer')], past: [] },
      ),
      reload,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'I am coming' }))

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('handing on a place that has been paid for', () => {
  const paidBurn = () => ({
    coming: [aBurn('e-1', 'Summer', anAttendance({ payment_status: 'paid', payment_date: '2026-07-01' }))],
    past: [],
  })

  const waiting = (over: Partial<MemberRosterEntry> = {}): MemberRosterEntry => ({
    avatar: null,
    id: 'att-2',
    event_id: 'e-1',
    account_id: 'a-2',
    joined_at: '2026-07-02T00:00:00.000Z',
    arrival_date: null,
    departure_date: null,
    lodging_option_id: null,
    lodging: null,
    helping: null,
    helping_option_ids: [],
    helping_other: null,
    notes: null,
    name: 'Bea',
    contact: null,
    allergies_notes: null,
    allergy_items: [],
    allergy_item_ids: [],
    payment_status: 'unpaid',
    waiting: true,
    ...over,
  })

  const roster = (entries: MemberRosterEntry[]) => ({
    event: {
      id: 'e-1',
      name: 'Summer',
      member_cap: 1,
      payment_info_markdown: '',
      transfer_info_markdown: '',
    },
    entries,
  })

  it('offers the hand-over instead of withdrawing, once they have paid', async () => {
    render(<YourBurns api={stub({}, paidBurn())} />)

    expect(await screen.findByRole('button', { name: 'Hand my place to somebody else' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'I cannot come after all' })).toBeNull()
  })

  it('offers withdrawing while nothing has been paid', async () => {
    render(<YourBurns api={stub({}, { coming: [aBurn('e-1', 'Summer', anAttendance())], past: [] })} />)

    expect(await screen.findByRole('button', { name: 'I cannot come after all' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Hand my place to somebody else' })).toBeNull()
  })

  it('offers only people who have not paid', async () => {
    const getMembers = vi.fn(() =>
      Promise.resolve(
        roster([waiting(), waiting({ account_id: 'a-3', name: 'Cyd', payment_status: 'paid' })]),
      ),
    )
    render(<YourBurns api={stub({ getMembers }, paidBurn())} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Hand my place to somebody else' }))

    expect(await screen.findByRole('option', { name: 'Bea' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'Cyd' })).toBeNull()
  })

  it('hands it to whoever was chosen', async () => {
    const transferMyPlace = vi.fn(() => Promise.resolve(undefined))
    render(
      <YourBurns
        api={stub({ getMembers: () => Promise.resolve(roster([waiting()])), transferMyPlace }, paidBurn())}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Hand my place to somebody else' }))
    const picker = await screen.findByLabelText('Who takes it')
    fireEvent.change(picker, { target: { value: 'a-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Hand it over' }))

    await waitFor(() => expect(transferMyPlace).toHaveBeenCalledWith('e-1', { to_account_id: 'a-2' }))
  })

  it('says everybody has paid when nobody can take it, rather than an empty picker', async () => {
    render(<YourBurns api={stub({ getMembers: () => Promise.resolve(roster([])) }, paidBurn())} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Hand my place to somebody else' }))

    expect(await screen.findByText(/Everybody at this burn has paid/)).toBeTruthy()
  })

  it('offers an unpaid member above the line, which is what the words now say', async () => {
    const getMembers = vi.fn(() =>
      Promise.resolve(roster([waiting({ account_id: 'a-4', name: 'Dag', waiting: false })])),
    )
    render(<YourBurns api={stub({ getMembers }, paidBurn())} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Hand my place to somebody else' }))

    expect(await screen.findByRole('option', { name: 'Dag' })).toBeTruthy()
  })

  it('drops the list it fetched last time when the picker is reopened', async () => {
    let entries = [waiting()]
    const getMembers = vi.fn(() => Promise.resolve(roster(entries)))
    render(<YourBurns api={stub({ getMembers }, paidBurn())} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Hand my place to somebody else' }))
    expect(await screen.findByRole('option', { name: 'Bea' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Never mind' }))
    entries = []
    fireEvent.click(screen.getByRole('button', { name: 'Hand my place to somebody else' }))

    expect(screen.queryByRole('option', { name: 'Bea' })).toBeNull()
    expect(await screen.findByText(/Everybody at this burn has paid/)).toBeTruthy()
  })

  it('reports a hand-over the server refused, rather than looking done', async () => {
    render(
      <YourBurns
        api={stub(
          {
            getMembers: () => Promise.resolve(roster([waiting()])),
            transferMyPlace: () => Promise.reject(apiError(409, 'conflict', 'nope')),
          },
          paidBurn(),
        )}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Hand my place to somebody else' }))
    fireEvent.change(await screen.findByLabelText('Who takes it'), { target: { value: 'a-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Hand it over' }))

    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})

describe('leaving a paid place to the hosts', () => {
  const paidBurn = () => ({
    coming: [aBurn('e-1', 'Summer', anAttendance({ payment_status: 'paid', payment_date: '2026-07-01' }))],
    past: [],
  })

  const LEAVE = 'I cannot come — leave my payment to the hosts'

  it('is offered beside the hand-over once they have paid', async () => {
    render(<YourBurns api={stub({}, paidBurn())} />)

    expect(await screen.findByRole('button', { name: LEAVE })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Hand my place to somebody else' })).toBeTruthy()
  })

  it('is not offered while nothing has been paid, the plain give-up being there instead', async () => {
    render(<YourBurns api={stub({}, { coming: [aBurn('e-1', 'Summer', anAttendance())], past: [] })} />)

    expect(await screen.findByRole('button', { name: 'I cannot come after all' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: LEAVE })).toBeNull()
  })

  it('says there is no refund before it is confirmed', async () => {
    render(<YourBurns api={stub({}, paidBurn())} />)

    fireEvent.click(await screen.findByRole('button', { name: LEAVE }))

    expect(screen.getByText(/There is no refund/u)).toBeTruthy()
  })

  it('gives up that burn’s place once confirmed, and asks for the bar’s list again', async () => {
    const reload = vi.fn()
    const donateMyPlace = vi.fn<YourBurnsApi['donateMyPlace']>(() => Promise.resolve(undefined))
    render(
      <BurnProvider value={{ status: 'ready', burns: [], selected: undefined, reload }}>
        <YourBurns api={stub({ donateMyPlace }, paidBurn())} />
      </BurnProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: LEAVE }))
    fireEvent.click(screen.getByRole('button', { name: /^Really /u }))

    await waitFor(() => expect(donateMyPlace).toHaveBeenCalledWith('e-1'))
    expect(reload).toHaveBeenCalled()
  })

  it('says the payment is not recorded when the server refuses it as unpaid', async () => {
    const donateMyPlace = vi.fn(() => Promise.reject(apiError(409, 'conflict', 'nope')))
    render(<YourBurns api={stub({ donateMyPlace }, paidBurn())} />)

    fireEvent.click(await screen.findByRole('button', { name: LEAVE }))
    fireEvent.click(screen.getByRole('button', { name: /^Really /u }))

    expect((await screen.findByRole('alert')).textContent).toContain('Your payment is not recorded')
  })
})

describe('arriving from a link to one burn', () => {
  const renderAt = (at: string) => {
    history.replaceState(null, '', at)

    return render(
      <LocationProvider>
        <YourBurns
          api={stub(
            {},
            {
              coming: [aBurn('e-1', 'Summer', anAttendance()), aBurn('e-2', 'Winter', anAttendance())],
              past: [],
            },
          )}
        />
      </LocationProvider>,
    )
  }

  const scrolled = () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll

    return scroll
  }

  afterEach(() => {
    history.replaceState(null, '', '/')
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  })

  it('scrolls to that burn’s section', async () => {
    const scroll = scrolled()
    renderAt('/profile?burn=e-2')

    await screen.findAllByLabelText('Arriving')

    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1))
    const section = scroll.mock.contexts[0]
    expect(section instanceof HTMLElement ? section.id : undefined).toBe('burn-e-2')
  })

  it('stays where it is without one', async () => {
    const scroll = scrolled()
    renderAt('/profile')

    await screen.findAllByLabelText('Arriving')

    expect(scroll).not.toHaveBeenCalled()
  })
})
