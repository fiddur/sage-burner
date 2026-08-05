import type { Attendance, MyBurn, MyBurnsResponse } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
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
  updateMyStay: () => Promise.reject(new Error('updateMyStay is not stubbed here')),
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
    // The reason join and leave stopped being scoped to the active burn: pressing
    // the second burn's button must not join the first.
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
    // There is no form until they are coming, and the lists are the form's data.
    const getEventOptions = vi.fn(() => Promise.resolve({ options: [] }))
    render(<YourBurns api={stub({ getEventOptions }, { coming: [aBurn('e-1', 'Summer')], past: [] })} />)

    await screen.findByRole('button', { name: 'I am coming' })
    expect(getEventOptions).not.toHaveBeenCalled()
  })

  it('explains a refused withdrawal rather than saying try again', async () => {
    // A 409 means they have paid, and retrying cannot change that.
    const leaveEvent = vi.fn(() => Promise.reject(apiError(409, 'conflict', 'nope')))
    render(
      <YourBurns
        api={stub({ leaveEvent }, { coming: [aBurn('e-1', 'Summer', anAttendance())], past: [] })}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'I cannot come after all' }))

    expect((await screen.findByRole('alert')).textContent).toContain('already paid')
  })

  it('says a burn is over rather than "try again" when joining it 404s', async () => {
    // The route answers 404 for a burn that has ended, deliberately — an ended burn
    // and an id that never existed get the same answer. Mapped only from 409, this
    // told the member to retry, which is advice that cannot help.
    const joinEvent = vi.fn(() => Promise.reject(apiError(404, 'not_found', 'Not found.')))
    render(<YourBurns api={stub({ joinEvent }, { coming: [aBurn('e-1', 'Summer')], past: [] })} />)

    fireEvent.click(await screen.findByRole('button', { name: 'I am coming' }))

    expect((await screen.findByRole('alert')).textContent).toContain('That burn is over')
  })

  it('still falls back to try-again for a status that is not a refusal', async () => {
    // The passing sibling: what the map replaces is the *refusals*, not the generic
    // failure. A 500 is worth retrying and should still say so.
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
  /**
   * The selector fetches once for the session, so this page — the only thing that
   * changes what belongs in it — has to say when it has. Without that, somebody who
   * joined and then opened Members or Schedule was told they were not coming to a
   * burn, and a reload was the only way out of it.
   */
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

    await waitFor(() => expect(leaveEvent).toHaveBeenCalledWith('e-1'))
    expect(reload).toHaveBeenCalled()
  })

  it('leaves it alone when the join was refused', async () => {
    // The passing sibling. A refresh fired before the write resolves would say the
    // list had changed when it had not.
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
