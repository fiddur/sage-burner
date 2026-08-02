import type { PaymentUpdate, RosterEntry, RosterResponse } from '@sage-burner/shared'

import { cleanup, render, screen, waitFor, within } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { RosterApi } from './AdminRoster.tsx'

import { apiError } from '../api/client.ts'
import { ViewerProvider } from '../viewer.tsx'
import { AdminRoster } from './AdminRoster.tsx'

afterEach(cleanup)

const anEntry = (over: Partial<RosterEntry> = {}): RosterEntry => ({
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
  ...over,
})

const renderPage = (
  api: RosterApi,
  viewer: Viewer = { status: 'signed-in', account: { id: 'a-1', roles: ['admin'] } },
) =>
  render(
    <ViewerProvider viewer={viewer}>
      <AdminRoster api={api} />
    </ViewerProvider>,
  )

describe('AdminRoster', () => {
  it('lists who is coming, in the order the API gives', async () => {
    // The order decides who has a place, so the page must not re-sort it into
    // something that disagrees with the member-facing list.
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
    expect(setPayment.mock.calls[0]?.[2]).toMatchObject({ payment_status: 'paid' })
    await waitFor(() => expect(getActiveRoster).toHaveBeenCalledTimes(2))
  })

  it('clears the date when a payment is unmarked', async () => {
    // Otherwise a date outlives the payment it recorded.
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

    await waitFor(() =>
      expect(setPayment.mock.calls[0]?.[2]).toEqual({ payment_status: 'unpaid', payment_date: null }),
    )
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

  it('does not fetch for someone who is not an organiser', async () => {
    const getActiveRoster = vi.fn(() => Promise.resolve(aRoster()))
    renderPage(stub({ getActiveRoster }), {
      status: 'signed-in',
      account: { id: 'a-1', roles: ['member'] },
    })

    expect(screen.getByText(/for organisers/)).toBeTruthy()
    expect(getActiveRoster).not.toHaveBeenCalled()
  })

  it('surfaces a failure to load', async () => {
    renderPage(stub({ getActiveRoster: () => Promise.reject(new Error('nope')) }))

    expect((await screen.findByRole('alert')).textContent).toContain('reload')
  })
})
