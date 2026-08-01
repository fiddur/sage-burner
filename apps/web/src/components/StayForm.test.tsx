import type { Attendance, EventOption } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { apiError } from '../api/client.ts'
import { StayForm } from './StayForm.tsx'

afterEach(cleanup)

const anAttendance = (over: Partial<Attendance> = {}): Attendance => ({
  id: 'att-1',
  event_id: 'e-1',
  account_id: 'a-1',
  joined_at: '2026-07-02T00:00:00.000Z',
  arrival_date: null,
  departure_date: null,
  lodging_option_id: null,
  shift_preference: null,
  notes: null,
  payment_status: 'unpaid',
  payment_date: null,
  ...over,
})

const anOption = (over: Partial<EventOption> & Pick<EventOption, 'id' | 'label'>): EventOption => ({
  event_id: 'e-1',
  kind: 'lodging',
  order: 0,
  capacity: null,
  ...over,
})

const LODGING: EventOption[] = [
  anOption({ id: 'o-1', label: 'Temple mattress', capacity: 9, order: 0 }),
  anOption({ id: 'o-2', label: 'Own tent', order: 1 }),
]

const fill = (label: string, value: string) => {
  fireEvent.input(screen.getByLabelText(label, { exact: false }), { target: { value } })
}

const saveIt = () => screen.getByRole('button', { name: 'Save these details' }).click()

describe('StayForm', () => {
  it('binds each end of the stay to the other, so the picker cannot invert it', () => {
    // A hint, not the rule — the server refuses an inverted pair either way. What
    // this removes is the ordinary way to produce one.
    render(
      <StayForm
        api={{ updateMyStay: vi.fn() }}
        attendance={anAttendance({ arrival_date: '2026-08-02', departure_date: '2026-08-04' })}
        onSaved={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Arriving').getAttribute('max')).toBe('2026-08-04')
    expect(screen.getByLabelText('Leaving').getAttribute('min')).toBe('2026-08-02')
  })

  it('leaves the other end unbounded while it is empty', () => {
    // `max=""` on a date input is not reliably "no maximum", so an unset partner
    // has to mean the attribute is absent.
    render(<StayForm api={{ updateMyStay: vi.fn() }} attendance={anAttendance()} onSaved={vi.fn()} />)

    expect(screen.getByLabelText('Arriving').hasAttribute('max')).toBe(false)
    expect(screen.getByLabelText('Leaving').hasAttribute('min')).toBe(false)
  })

  it('offers the burn\u2019s lodging list, with how many are left', () => {
    render(
      <StayForm
        api={{ updateMyStay: vi.fn() }}
        attendance={anAttendance()}
        lodgingOptions={LODGING}
        taken={{ 'o-1': 4 }}
        onSaved={vi.fn()}
      />,
    )

    expect(screen.getByRole('option', { name: 'Temple mattress — 5 left' })).toBeTruthy()
    // No limit, so no count to offer.
    expect(screen.getByRole('option', { name: 'Own tent' })).toBeTruthy()
  })

  it('disables an option that is full, and says so', async () => {
    render(
      <StayForm
        api={{ updateMyStay: vi.fn() }}
        attendance={anAttendance()}
        lodgingOptions={LODGING}
        taken={{ 'o-1': 9 }}
        onSaved={vi.fn()}
      />,
    )

    const full = screen.getByRole('option', { name: 'Temple mattress — full' })

    expect(full).toHaveProperty('disabled', true)
    expect(screen.getByRole('option', { name: 'Own tent' })).toHaveProperty('disabled', false)
  })

  it('leaves the option they are already in selectable, even when it is full', () => {
    // Their own place counts towards the total, so it always reads as full to
    // them. Disabling it would make the select fall back to "not decided" and
    // quietly give up their bed on the next save.
    render(
      <StayForm
        api={{ updateMyStay: vi.fn() }}
        attendance={anAttendance({ lodging_option_id: 'o-1' })}
        lodgingOptions={LODGING}
        taken={{ 'o-1': 9 }}
        onSaved={vi.fn()}
      />,
    )

    expect(screen.getByRole('option', { name: 'Temple mattress — full' })).toHaveProperty('disabled', false)
    expect(screen.getByLabelText(/sleeping/)).toHaveProperty('value', 'o-1')
  })

  it('sends the option id, and null for not decided', async () => {
    const updateMyStay = vi.fn(() => Promise.resolve({ attendance: anAttendance() }))
    render(
      <StayForm
        api={{ updateMyStay }}
        attendance={anAttendance()}
        lodgingOptions={LODGING}
        onSaved={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText(/sleeping/), { target: { value: 'o-2' } })
    saveIt()

    await waitFor(() =>
      expect(updateMyStay).toHaveBeenCalledWith(expect.objectContaining({ lodging_option_id: 'o-2' })),
    )
  })

  it('shows what is already recorded', () => {
    render(
      <StayForm
        api={{ updateMyStay: vi.fn() }}
        attendance={anAttendance({ lodging_option_id: 'o-1', arrival_date: '2026-08-01' })}
        lodgingOptions={LODGING}
        onSaved={vi.fn()}
      />,
    )

    expect(screen.getByLabelText(/sleeping/)).toHaveProperty('value', 'o-1')
    expect(screen.getByLabelText('Arriving')).toHaveProperty('value', '2026-08-01')
  })

  it('sends nulls for the fields left blank', async () => {
    // "Not said" has one representation; an empty string would read as an answer.
    const updateMyStay = vi.fn(() => Promise.resolve({ attendance: anAttendance() }))
    render(<StayForm api={{ updateMyStay }} attendance={anAttendance()} onSaved={vi.fn()} />)

    saveIt()

    await waitFor(() =>
      expect(updateMyStay).toHaveBeenCalledWith({
        arrival_date: null,
        departure_date: null,
        lodging_option_id: null,
        shift_preference: null,
        notes: null,
      }),
    )
  })

  it('refuses a departure before the arrival, naming the problem', async () => {
    // The API refuses it too; catching it here means the message says what is
    // wrong rather than arriving as a bare 400.
    const updateMyStay = vi.fn(() => Promise.resolve({ attendance: anAttendance() }))
    render(<StayForm api={{ updateMyStay }} attendance={anAttendance()} onSaved={vi.fn()} />)

    fill('Arriving', '2026-08-05')
    fill('Leaving', '2026-08-01')
    saveIt()

    expect((await screen.findByRole('alert')).textContent).toContain('before your arrival')
    expect(updateMyStay).not.toHaveBeenCalled()
  })

  it('hands the saved row back, so the page does not go stale', async () => {
    const saved = anAttendance({ lodging_option_id: 'o-1' })
    const onSaved = vi.fn()
    render(
      <StayForm
        api={{ updateMyStay: () => Promise.resolve({ attendance: saved }) }}
        attendance={anAttendance()}
        onSaved={onSaved}
      />,
    )

    saveIt()

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved))
    expect((await screen.findByRole('status')).textContent).toContain('Saved')
  })

  it('explains a rejected date pair from the server rather than saying try again', async () => {
    render(
      <StayForm
        api={{ updateMyStay: () => Promise.reject(apiError(400, 'bad_request', 'nope')) }}
        attendance={anAttendance()}
        onSaved={vi.fn()}
      />,
    )

    saveIt()

    expect((await screen.findByRole('alert')).textContent).toContain('do not work together')
  })

  it('offers no way to change the payment status', async () => {
    // It is the organiser's to set; a control here would always fail.
    render(
      <StayForm
        api={{ updateMyStay: vi.fn() }}
        attendance={anAttendance({ payment_status: 'unpaid' })}
        onSaved={vi.fn()}
      />,
    )

    expect(screen.queryByLabelText(/pay/i)).toBeNull()
  })
})
