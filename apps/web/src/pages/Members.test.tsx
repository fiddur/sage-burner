import type { MemberRosterEntry, MemberRosterResponse, MyBurn } from '@sage-burner/shared'

import { cleanup, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { MembersApi } from './Members.tsx'

import { BurnProvider } from '../burn.tsx'
import { ViewerProvider } from '../viewer.tsx'
import { Members } from './Members.tsx'

afterEach(cleanup)

const anEntry = (over: Partial<MemberRosterEntry> = {}): MemberRosterEntry => ({
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
  name: 'Ana',
  contact: 'ana on discord',
  allergies_notes: null,
  payment_status: 'unpaid',
  waiting: false,
  ...over,
})

const aRoster = (over: Partial<MemberRosterResponse> = {}): MemberRosterResponse => ({
  event: { id: 'e-1', name: 'Summer burn', member_cap: 2 },
  entries: [],
  ...over,
})

const stub = (roster = aRoster()): MembersApi => ({ getMembers: () => Promise.resolve(roster) })

/** The selector's view of the same burn, so the two cannot describe different ones. */
const CHOSEN: MyBurn = {
  event: {
    id: 'e-1',
    name: 'Summer burn',
    slug: 'summer-burn',
    start_date: '2026-08-01',
    end_date: '2026-08-05',
    start_time: '16:00',
    end_time: '12:00',
  },
  attendance: null,
}

const MEMBER: Viewer = { status: 'signed-in', account: { id: 'a-1', name: null, roles: ['member'] } }

// `null`, not `undefined`: passing `undefined` to a parameter with a default gets
// the default, so "no burn" written that way silently rendered the usual one.
const renderPage = (api: MembersApi, viewer: Viewer = MEMBER, burn: MyBurn | null = CHOSEN) =>
  render(
    <ViewerProvider viewer={viewer}>
      <BurnProvider
        value={{ status: 'ready', burns: burn === null ? [] : [burn], selected: burn ?? undefined }}
      >
        <Members api={api} />
      </BurnProvider>
    </ViewerProvider>,
  )

describe('Members', () => {
  it('shows a member the allergies, which is what the page is for', async () => {
    renderPage(stub(aRoster({ entries: [anEntry({ name: 'Ana', allergies_notes: 'peanuts' })] })))

    expect(await screen.findByText('peanuts')).toBeTruthy()
    expect(screen.getByText('ana on discord')).toBeTruthy()
  })

  it('lists them in the order the API gives, rather than re-sorting', async () => {
    // That order decides who has a place. A page that sorted for itself would
    // disagree with the organiser's list about who is on the waiting line.
    renderPage(stub(aRoster({ entries: [anEntry({ name: 'Second' }), anEntry({ name: 'First' })] })))

    await screen.findByText('Second')
    const rows = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.textContent ?? '')

    expect(rows[0]).toContain('Second')
    expect(rows[1]).toContain('First')
  })

  it('says who has paid, since that is what makes joining definite', async () => {
    renderPage(
      stub(
        aRoster({
          entries: [
            anEntry({ name: 'Ada', payment_status: 'paid' }),
            anEntry({ name: 'Bea', payment_status: 'unpaid' }),
          ],
        }),
      ),
    )

    await screen.findByText('Ada')
    const rows = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.textContent ?? '')

    expect(rows[0]).toContain('yes')
    expect(rows[1]).toContain('not yet')
  })

  it('marks who is waiting and counts the places taken', async () => {
    renderPage(
      stub(
        aRoster({
          entries: [anEntry({ name: 'In' }), anEntry({ name: 'Out', waiting: true })],
        }),
      ),
    )

    expect(await screen.findByText(/1 of 2 places taken, 1 waiting/)).toBeTruthy()
  })

  it('says a name is missing rather than falling back to an address it was not sent', async () => {
    // The organiser's list falls back to the email. This response carries none, so
    // a fallback written the same way would print `undefined`.
    renderPage(stub(aRoster({ entries: [anEntry({ name: null, contact: null })] })))

    expect(await screen.findByText('Name not filled in yet')).toBeTruthy()
    expect(screen.getByText('no contact given')).toBeTruthy()
  })

  it('asks the API nothing for somebody still waiting on a decision', async () => {
    // An applicant with an account and no roles. Asking anyway renders a failure
    // where the explanation belongs, and spends a round trip on a certain 403.
    const getMembers = vi.fn(() => Promise.reject(new Error('should not be called')))
    renderPage({ getMembers }, { status: 'signed-in', account: { id: 'a-9', name: null, roles: [] } })

    expect(await screen.findByText(/for members/)).toBeTruthy()
    expect(getMembers).not.toHaveBeenCalled()
  })

  it('opens to an organiser holding admin without member', async () => {
    renderPage(stub(aRoster({ entries: [anEntry({ name: 'Ana' })] })), {
      status: 'signed-in',
      account: { id: 'a-2', name: null, roles: ['admin'] },
    })

    expect(await screen.findByText('Ana')).toBeTruthy()
  })

  it('says so when no burn is open, rather than showing an empty table', async () => {
    renderPage(stub(aRoster({ event: null })), MEMBER, null)

    expect(await screen.findByText(/no burn open/)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
