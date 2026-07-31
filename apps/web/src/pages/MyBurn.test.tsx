import type { Attendance, MyAttendanceResponse } from '@sage-burner/shared'

import { cleanup, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { MyBurnApi } from './MyBurn.tsx'

import { apiError } from '../api/client.ts'
import { ViewerProvider } from '../viewer.tsx'
import { MyBurn } from './MyBurn.tsx'

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

const theBurn = { id: 'e-1', name: 'Summer burn', slug: 'summer-2026' }

const stub = (over: Partial<MyBurnApi> = {}, mine?: MyAttendanceResponse): MyBurnApi => ({
  getMyAttendance: () => Promise.resolve(mine ?? { event: theBurn, attendance: null }),
  joinActiveEvent: () => Promise.reject(new Error('joinActiveEvent is not stubbed here')),
  leaveActiveEvent: () => Promise.reject(new Error('leaveActiveEvent is not stubbed here')),
  ...over,
})

const renderPage = (
  api: MyBurnApi,
  viewer: Viewer = { status: 'signed-in', account: { id: 'a-1', roles: ['member'] } },
) =>
  render(
    <ViewerProvider viewer={viewer}>
      <MyBurn api={api} />
    </ViewerProvider>,
  )

describe('MyBurn', () => {
  it('offers to join when they have not said', async () => {
    renderPage(stub())

    expect(await screen.findByRole('button', { name: 'I am coming' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Summer burn')
  })

  it('joins and reflects it without a reload', async () => {
    const joinActiveEvent = vi.fn(() => Promise.resolve({ attendance: anAttendance() }))
    const getMyAttendance = vi
      .fn()
      .mockResolvedValueOnce({ event: theBurn, attendance: null })
      .mockResolvedValueOnce({ event: theBurn, attendance: anAttendance() })
    renderPage(stub({ joinActiveEvent, getMyAttendance }))

    ;(await screen.findByRole('button', { name: 'I am coming' })).click()

    await waitFor(() => expect(joinActiveEvent).toHaveBeenCalled())
    expect((await screen.findByRole('status')).textContent).toContain('on the list')
  })

  it('says whether they have paid, which only an organiser can change', async () => {
    renderPage(stub({}, { event: theBurn, attendance: anAttendance({ payment_status: 'paid' }) }))

    expect((await screen.findByRole('status')).textContent).toContain('you have paid')
    // No control for it: payment is admin-set, and offering one here would be a
    // button that always fails.
    expect(screen.queryByRole('button', { name: /paid/i })).toBeNull()
  })

  it('gives a partial payment its own sentence rather than reading as unpaid', async () => {
    renderPage(stub({}, { event: theBurn, attendance: anAttendance({ payment_status: 'partial' }) }))

    const said = (await screen.findByRole('status')).textContent
    expect(said).toContain('part of the fee')
    expect(said).not.toContain('not yet paid')
  })

  it('lets them withdraw', async () => {
    const leaveActiveEvent = vi.fn(() => Promise.resolve(undefined))
    const getMyAttendance = vi
      .fn()
      .mockResolvedValueOnce({ event: theBurn, attendance: anAttendance() })
      .mockResolvedValueOnce({ event: theBurn, attendance: null })
    renderPage(stub({ leaveActiveEvent, getMyAttendance }))

    ;(await screen.findByRole('button', { name: 'I cannot come after all' })).click()

    await waitFor(() => expect(leaveActiveEvent).toHaveBeenCalled())
    expect(await screen.findByRole('button', { name: 'I am coming' })).toBeTruthy()
  })

  it('explains a refused withdrawal rather than saying try again', async () => {
    // A 409 means they have paid, and retrying cannot change that — an organiser
    // has to sort it out.
    renderPage(
      stub(
        { leaveActiveEvent: () => Promise.reject(apiError(409, 'conflict', 'nope')) },
        { event: theBurn, attendance: anAttendance() },
      ),
    )

    ;(await screen.findByRole('button', { name: 'I cannot come after all' })).click()

    expect((await screen.findByRole('alert')).textContent).toContain('already paid')
  })

  it('says so when no burn is open, rather than showing a dead button', async () => {
    renderPage(stub({}, { event: null, attendance: null }))

    expect(await screen.findByText(/no burn open/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'I am coming' })).toBeNull()
  })

  it('surfaces a failure to load', async () => {
    renderPage(stub({ getMyAttendance: () => Promise.reject(new Error('nope')) }))

    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('does not fetch for someone who is not a member', async () => {
    const getMyAttendance = vi.fn(() => Promise.resolve({ event: theBurn, attendance: null }))
    renderPage(stub({ getMyAttendance }), { status: 'signed-out' })

    expect(screen.getByText(/for members/)).toBeTruthy()
    expect(getMyAttendance).not.toHaveBeenCalled()
  })
})
