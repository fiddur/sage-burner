import type { AccountRole, Attendance, MyBurn, PaymentStatus } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { LocationProvider } from 'preact-iso'
import { afterEach, describe, expect, it } from 'vitest'

import type { Viewer } from '../viewer.tsx'

import { BurnProvider } from '../burn.tsx'
import { HIDDEN_KEY } from '../payment-due.ts'
import { ViewerProvider } from '../viewer.tsx'
import { PaymentDue } from './PaymentDue.tsx'

afterEach(cleanup)
afterEach(() => history.replaceState(null, '', '/'))

const anAttendance = (payment_status: PaymentStatus): Attendance => ({
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
  payment_status,
  payment_date: null,
})

const aBurn = (attendance: Attendance | null): MyBurn => ({
  event: {
    id: 'e-1',
    name: 'Summer burn',
    slug: 'summer-burn',
    start_date: '2026-08-01',
    end_date: '2026-08-05',
    start_time: '16:00',
    end_time: '12:00',
  },
  attendance,
})

const signedInAs = (...roles: AccountRole[]): Viewer => ({
  status: 'signed-in',
  account: { id: 'a-1', name: 'Ada', avatar: null, roles },
})

const aStore = () => {
  const held = new Map<string, string>()

  return {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => {
      held.set(key, value)
    },
  }
}

const renderAt = ({
  burn,
  viewer = signedInAs('member'),
  at = '/',
  store = aStore(),
}: {
  burn: MyBurn | undefined
  viewer?: Viewer
  at?: string
  store?: ReturnType<typeof aStore>
}) => {
  history.replaceState(null, '', at)

  render(
    <LocationProvider>
      <ViewerProvider viewer={viewer}>
        <BurnProvider value={{ status: 'ready', burns: burn === undefined ? [] : [burn], selected: burn }}>
          <PaymentDue store={store} now={() => new Date('2026-09-25T10:00:00Z')} />
        </BurnProvider>
      </ViewerProvider>
    </LocationProvider>,
  )

  return store
}

describe('the reminder that a place is not paid for', () => {
  it('shows for an attendance nobody has recorded payment for, linking to that burn’s members page', () => {
    renderAt({ burn: aBurn(anAttendance('unpaid')) })

    expect(screen.getByRole('status').textContent).toContain(
      'To secure your spot, your membership fee needs to be paid. See the members page for instructions.',
    )
    expect(screen.getByRole('link', { name: 'members page' }).getAttribute('href')).toBe('/members?burn=e-1')
  })

  it('says nothing once the place is paid for', () => {
    renderAt({ burn: aBurn(anAttendance('paid')) })

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('says nothing to somebody not coming to the burn', () => {
    renderAt({ burn: aBurn(null) })

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('says nothing where no burn is selected', () => {
    renderAt({ burn: undefined })

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('says nothing to somebody signed out', () => {
    renderAt({ burn: aBurn(anAttendance('unpaid')), viewer: { status: 'signed-out' } })

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('says nothing to somebody not yet approved', () => {
    renderAt({ burn: aBurn(anAttendance('unpaid')), viewer: signedInAs() })

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows to an admin who is coming and has not paid', () => {
    renderAt({ burn: aBurn(anAttendance('unpaid')), viewer: signedInAs('admin') })

    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('says nothing on the members page, which carries the instructions itself', () => {
    renderAt({ burn: aBurn(anAttendance('unpaid')), at: '/members?burn=e-1' })

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('still shows on a member’s own profile page', () => {
    renderAt({ burn: aBurn(anAttendance('unpaid')), at: '/members/a-1' })

    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('goes away for the day when hidden, and remembers when', () => {
    const store = renderAt({ burn: aBurn(anAttendance('unpaid')) })

    fireEvent.click(screen.getByRole('button', { name: 'Hide for today' }))

    expect(screen.queryByRole('status')).toBeNull()
    expect(store.getItem(HIDDEN_KEY)).toBe('2026-09-25T10:00:00.000Z')
  })

  it('stays away on the next visit the same day', () => {
    const store = aStore()
    store.setItem(HIDDEN_KEY, '2026-09-25T09:00:00.000Z')

    renderAt({ burn: aBurn(anAttendance('unpaid')), store })

    expect(screen.queryByRole('status')).toBeNull()
  })
})
