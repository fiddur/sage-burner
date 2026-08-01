import type { Attendance } from '@sage-burner/shared'

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
  lodging: null,
  shift_preference: null,
  notes: null,
  payment_status: 'unpaid',
  payment_date: null,
  ...over,
})

const fill = (label: string, value: string) => {
  fireEvent.input(screen.getByLabelText(label, { exact: false }), { target: { value } })
}

const saveIt = () => screen.getByRole('button', { name: 'Save these details' }).click()

describe('StayForm', () => {
  it('binds each end of the stay to the other, so the picker cannot invert it', async () => {
    // A hint, not the rule — the server refuses an inverted pair either way. What
    // this removes is the ordinary way to produce one.
    render(
      <StayForm
        attendance={anAttendance({ arrival_date: '2026-08-02', departure_date: '2026-08-04' })}
        busy={false}
        onSave={() => undefined}
      />,
    )

    expect((await screen.findByLabelText('Arriving')).getAttribute('max')).toBe('2026-08-04')
    expect(screen.getByLabelText('Leaving').getAttribute('min')).toBe('2026-08-02')
  })

  it('leaves the other end unbounded while it is empty', async () => {
    // `max=""` on a date input is not "no maximum" in every engine, so an unset
    // partner has to mean the attribute is absent.
    render(<StayForm attendance={anAttendance({})} busy={false} onSave={() => undefined} />)

    expect((await screen.findByLabelText('Arriving')).hasAttribute('max')).toBe(false)
    expect(screen.getByLabelText('Leaving').hasAttribute('min')).toBe(false)
  })

  it('shows what is already recorded', () => {
    render(
      <StayForm
        api={{ updateMyStay: vi.fn() }}
        attendance={anAttendance({ lodging: 'Hammock', arrival_date: '2026-08-01' })}
        onSaved={vi.fn()}
      />,
    )

    expect(screen.getByLabelText(/sleeping/)).toHaveProperty('value', 'Hammock')
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
        lodging: null,
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
    const saved = anAttendance({ lodging: 'Barn' })
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
