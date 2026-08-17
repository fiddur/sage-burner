import type { PaymentUpdate, RosterEntry, RosterResponse } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { RosterApi } from './AdminRoster.tsx'

import { apiError } from '../api/client.ts'
import { ViewerProvider } from '../viewer.tsx'
import { AdminRoster } from './AdminRoster.tsx'

afterEach(cleanup)

const anEntry = (over: Partial<RosterEntry> = {}): RosterEntry => ({
  avatar: null,
  id: `att-${over.name ?? 'x'}`,
  event_id: 'e-1',
  account_id: `acc-${over.name ?? 'x'}`,
  joined_at: '2026-07-01T00:00:00.000Z',
  arrival_date: null,
  departure_date: null,
  lodging_option_id: null,
  lodging: null,
  helping: null,
  helping_option_ids: [],
  helping_other: null,
  notes: null,
  payment_status: 'unpaid',
  payment_date: null,
  email: 'someone@example.org',
  name: 'Ana',
  contact: 'ana on discord',
  allergies_notes: null,
  allergy_items: [],
  waiting: false,
  ...over,
})

const aRoster = (over: Partial<RosterResponse> = {}): RosterResponse => ({
  event: { id: 'e-1', name: 'Summer burn', member_cap: 2 },
  entries: [],
  ...over,
})

const stub = (over: Partial<RosterApi> = {}, roster = aRoster()): RosterApi => ({
  getActiveRoster: () => Promise.resolve(roster),
  setPayment: () => Promise.reject(new Error('setPayment is not stubbed here')),
  getAdminAccounts: () => Promise.resolve({ accounts: [] }),
  adminAddAttendance: () => Promise.reject(new Error('adminAddAttendance is not stubbed here')),
  ...over,
})

const renderPage = (
  api: RosterApi,
  viewer: Viewer = {
    status: 'signed-in',
    account: { id: 'a-1', name: null, avatar: null, roles: ['admin'] },
  },
) =>
  render(
    <ViewerProvider viewer={viewer}>
      <AdminRoster api={api} />
    </ViewerProvider>,
  )

describe('AdminRoster', () => {
  it('lists who is coming, in the order the API gives', async () => {
    renderPage(stub({}, aRoster({ entries: [anEntry({ name: 'Second' }), anEntry({ name: 'First' })] })))

    await screen.findByText('Second')
    const cells = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.textContent ?? '')
    expect(cells[0]).toContain('Second')
    expect(cells[1]).toContain('First')
  })

  it('counts places taken against the cap', async () => {
    renderPage(
      stub(
        {},
        aRoster({
          entries: [anEntry({ name: 'In' }), anEntry({ name: 'Out', waiting: true })],
        }),
      ),
    )

    expect((await screen.findByText(/places taken/)).textContent).toContain('1 of 2 places taken')
    expect(screen.getByText(/places taken/).textContent).toContain('1 waiting')
  })

  it('marks who is on the waiting list, in their own row', async () => {
    renderPage(
      stub({}, aRoster({ entries: [anEntry({ name: 'In' }), anEntry({ name: 'Out', waiting: true })] })),
    )

    await screen.findByText('Out')
    const rowFor = (name: string) => within(screen.getByText(name).closest('tr') as HTMLElement)
    expect(rowFor('Out').getByText(/waiting/)).toBeTruthy()
    expect(rowFor('In').queryByText(/waiting/)).toBeNull()
  })

  it('records a payment and reloads, since paying re-sorts the list', async () => {
    const setPayment = vi.fn((_eventId: string, _accountId: string, _body: PaymentUpdate) =>
      Promise.resolve({ attendance: {} as never }),
    )
    const getActiveRoster = vi
      .fn()
      .mockResolvedValueOnce(aRoster({ entries: [anEntry({ name: 'Ana' })] }))
      .mockResolvedValueOnce(
        aRoster({ entries: [anEntry({ name: 'Ana', payment_status: 'paid', payment_date: '2026-07-04' })] }),
      )
    renderPage(stub({ setPayment, getActiveRoster }))

    ;(await screen.findByLabelText('Paid — Ana')).click()

    await waitFor(() => expect(setPayment).toHaveBeenCalled())
    expect(setPayment.mock.calls[0]?.[2]).toEqual({ payment_status: 'paid' })
    await waitFor(() => expect(getActiveRoster).toHaveBeenCalledTimes(2))
  })

  it('locks every box while one payment is being recorded, not just its own', async () => {
    let settle: () => void = () => undefined
    const setPayment = vi.fn(
      (_eventId: string, _accountId: string, _body: PaymentUpdate) =>
        new Promise<{ attendance: never }>((resolve) => {
          settle = () => resolve({ attendance: {} as never })
        }),
    )
    renderPage(
      stub(
        { setPayment },
        aRoster({
          entries: [
            anEntry({ account_id: 'a-2', name: 'Ana' }),
            anEntry({ account_id: 'a-3', name: 'Bo', email: 'bo@example.org' }),
          ],
        }),
      ),
    )

    ;(await screen.findByLabelText('Paid — Ana')).click()

    await waitFor(() => expect(setPayment).toHaveBeenCalledTimes(1))
    const other = screen.getByLabelText('Paid — Bo')
    expect(other.hasAttribute('disabled')).toBe(true)

    settle()

    await waitFor(() => expect(screen.getByLabelText('Paid — Bo').hasAttribute('disabled')).toBe(false))
  })

  it('sends the status alone, leaving the date to the server', async () => {
    const setPayment = vi.fn((_eventId: string, _accountId: string, _body: PaymentUpdate) =>
      Promise.resolve({ attendance: {} as never }),
    )
    renderPage(
      stub(
        { setPayment },
        aRoster({
          entries: [anEntry({ name: 'Ana', payment_status: 'paid', payment_date: '2026-07-04' })],
        }),
      ),
    )

    ;(await screen.findByLabelText('Paid — Ana')).click()

    await waitFor(() => expect(setPayment.mock.calls[0]?.[2]).toEqual({ payment_status: 'unpaid' }))
  })

  it('surfaces a failed payment rather than showing it as recorded', async () => {
    renderPage(
      stub(
        { setPayment: () => Promise.reject(apiError(404, 'not_found', 'Gone.')) },
        aRoster({ entries: [anEntry({ name: 'Ana' })] }),
      ),
    )

    ;(await screen.findByLabelText('Paid — Ana')).click()

    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('says so when no burn is open', async () => {
    renderPage(stub({}, aRoster({ event: null })))

    expect(await screen.findByText(/no burn open/)).toBeTruthy()
  })

  it('says so when nobody has joined yet', async () => {
    renderPage(stub())

    expect(await screen.findByText(/Nobody has said/)).toBeTruthy()
  })

  it('offers no export with nothing to export', async () => {
    renderPage(stub())

    expect(await screen.findByRole('button', { name: 'Download as CSV' })).toHaveProperty('disabled', true)
  })

  it('falls back to the email when someone has no name yet', async () => {
    renderPage(
      stub({}, aRoster({ entries: [anEntry({ name: null, contact: null, email: 'x@example.org' })] })),
    )

    expect(await screen.findAllByText(/x@example.org/)).not.toHaveLength(0)
  })

  it('does not fetch for someone who does not have admin', async () => {
    const getActiveRoster = vi.fn(() => Promise.resolve(aRoster()))
    renderPage(stub({ getActiveRoster }), {
      status: 'signed-in',
      account: { id: 'a-1', name: null, avatar: null, roles: ['member'] },
    })

    expect(screen.getByText(/for admins/)).toBeTruthy()
    expect(getActiveRoster).not.toHaveBeenCalled()
  })

  it('surfaces a failure to load', async () => {
    renderPage(stub({ getActiveRoster: () => Promise.reject(new Error('nope')) }))

    expect((await screen.findByRole('alert')).textContent).toContain('reload')
  })
})

describe('adding somebody to the burn', () => {
  const anAccount = (id: string, email: string) => ({
    id,
    email,
    roles: ['member' as const],
    created_at: '2026-07-01T00:00:00.000Z',
  })

  it('puts a member on the burn and reloads the list', async () => {
    const adminAddAttendance = vi.fn(() => Promise.resolve({ attendance: {} as never }))
    const getActiveRoster = vi.fn(() => Promise.resolve(aRoster()))
    renderPage(
      stub({
        getActiveRoster,
        getAdminAccounts: () => Promise.resolve({ accounts: [anAccount('a-9', 'late@example.org')] }),
        adminAddAttendance,
      }),
    )

    fireEvent.change(await screen.findByLabelText('Who to add to this burn'), {
      target: { value: 'a-9' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add them' }))

    await waitFor(() => expect(adminAddAttendance).toHaveBeenCalledWith('e-1', { account_id: 'a-9' }))
    await waitFor(() => expect(getActiveRoster).toHaveBeenCalledTimes(2))
  })

  it('does not offer somebody who is already coming', async () => {
    renderPage(
      stub(
        {
          getAdminAccounts: () =>
            Promise.resolve({
              accounts: [anAccount('a-1', 'here@example.org'), anAccount('a-9', 'late@example.org')],
            }),
        },
        aRoster({ entries: [anEntry({ account_id: 'a-1', email: 'here@example.org' })] }),
      ),
    )

    await screen.findByLabelText('Who to add to this burn')

    expect(screen.queryByRole('option', { name: 'late@example.org' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'here@example.org' })).toBeNull()
  })

  it('says so when there is nobody left to add', async () => {
    renderPage(
      stub(
        { getAdminAccounts: () => Promise.resolve({ accounts: [anAccount('a-1', 'here@example.org')] }) },
        aRoster({ entries: [anEntry({ account_id: 'a-1' })] }),
      ),
    )

    expect(await screen.findByText(/already on this burn/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add them' })).toBeNull()
  })

  it('keeps the roster when the accounts cannot be loaded', async () => {
    renderPage(
      stub(
        { getAdminAccounts: () => Promise.reject(new Error('nope')) },
        aRoster({ entries: [anEntry({ name: 'Ana' })] }),
      ),
    )

    expect(await screen.findByText('Ana')).toBeTruthy()
    expect(screen.queryByLabelText('Who to add to this burn')).toBeNull()
  })
})
