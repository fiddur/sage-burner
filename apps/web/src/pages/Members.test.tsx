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
  allergy_items: [],
  payment_status: 'unpaid',
  waiting: false,
  ...over,
})

const aRoster = (over: Partial<MemberRosterResponse> = {}): MemberRosterResponse => ({
  event: {
    id: 'e-1',
    name: 'Summer burn',
    member_cap: 2,
    payment_info_markdown: '',
    transfer_info_markdown: '',
  },
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

const MEMBER: Viewer = {
  status: 'signed-in',
  account: { id: 'a-1', name: null, avatar: null, roles: ['member'] },
}

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
    renderPage(
      { getMembers },
      { status: 'signed-in', account: { id: 'a-9', name: null, avatar: null, roles: [] } },
    )

    expect(await screen.findByText(/for members/)).toBeTruthy()
    expect(getMembers).not.toHaveBeenCalled()
  })

  it('opens to an organiser holding admin without member', async () => {
    renderPage(stub(aRoster({ entries: [anEntry({ name: 'Ana' })] })), {
      status: 'signed-in',
      account: { id: 'a-2', name: null, avatar: null, roles: ['admin'] },
    })

    expect(await screen.findByText('Ana')).toBeTruthy()
  })

  it('says so when no burn is open, rather than showing an empty table', async () => {
    renderPage(stub(aRoster({ event: null })), MEMBER, null)

    expect(await screen.findByText(/not coming to a burn yet/)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('how to pay', () => {
  const paying = (over: Partial<MemberRosterEntry> = {}) =>
    anEntry({ account_id: 'a-1', payment_status: 'unpaid', ...over })

  it('tells somebody who has not paid how to', async () => {
    renderPage(
      stub(
        aRoster({
          event: {
            id: 'e-1',
            name: 'Summer burn',
            member_cap: 2,
            payment_info_markdown: '**Swish** 123',
            transfer_info_markdown: '',
          },
          entries: [paying()],
        }),
      ),
    )

    expect(await screen.findByText('Swish')).toBeTruthy()
  })

  it('says nothing to somebody who has', async () => {
    // Everybody else has done it, and a standing instruction to pay is noise on a
    // page they read for the allergies.
    renderPage(
      stub(
        aRoster({
          event: {
            id: 'e-1',
            name: 'Summer burn',
            member_cap: 2,
            payment_info_markdown: '**Swish** 123',
            transfer_info_markdown: '',
          },
          entries: [paying({ payment_status: 'paid' })],
        }),
      ),
    )

    await screen.findByText('Summer burn')
    expect(screen.queryByText('Swish')).toBeNull()
  })

  it('says nothing when no organiser has written any', async () => {
    renderPage(stub(aRoster({ entries: [paying()] })))

    await screen.findByText('Summer burn')
    expect(document.querySelector('.notice')).toBeNull()
  })
})

describe('where the places run out', () => {
  const full = (over: Partial<MemberRosterResponse['event']> = {}) =>
    aRoster({
      event: {
        id: 'e-1',
        name: 'Summer burn',
        member_cap: 2,
        payment_info_markdown: '**Swish** 123',
        transfer_info_markdown: 'Ask on the waiting list.',
        ...over,
      },
      entries: [
        anEntry({ name: 'Ada', payment_status: 'paid' }),
        anEntry({ name: 'Bea', payment_status: 'paid' }),
        anEntry({ name: 'Cyd', account_id: 'a-1', waiting: true }),
        anEntry({ name: 'Dee', waiting: true }),
      ],
    })

  it('draws one waiting-list line, above the first person past the cap', async () => {
    renderPage(stub(full()))

    const lines = await screen.findAllByText('Waiting list')
    expect(lines).toHaveLength(1)

    // The row order is the answer to who has a place, so the line's position is it.
    const rows = [...document.querySelectorAll('tbody tr')]
    expect(rows.findIndex((row) => row.textContent?.includes('Waiting list'))).toBe(2)
  })

  it('draws none at all while there is room', async () => {
    // The passing sibling: a line drawn unconditionally would satisfy the test above.
    renderPage(
      stub(
        aRoster({
          entries: [anEntry({ name: 'Ada' }), anEntry({ name: 'Bea' })],
        }),
      ),
    )

    await screen.findByText('Ada')
    expect(screen.queryByText('Waiting list')).toBeNull()
  })

  it('says how a place changes hands, not how to pay, once the burn is full', async () => {
    // Paying no longer gets anybody in, so the payment instructions are the wrong
    // thing to leave up in front of somebody who has not paid.
    renderPage(stub(full()))

    expect(await screen.findByText('Ask on the waiting list.')).toBeTruthy()
    expect(screen.queryByText(/Swish/)).toBeNull()
  })

  it('still says how to pay while places are left', async () => {
    renderPage(
      stub(
        aRoster({
          event: {
            id: 'e-1',
            name: 'Summer burn',
            member_cap: 42,
            payment_info_markdown: '**Swish** 123',
            transfer_info_markdown: 'Ask on the waiting list.',
          },
          entries: [anEntry({ name: 'Cyd', account_id: 'a-1' })],
        }),
      ),
    )

    expect(await screen.findByText(/Swish/)).toBeTruthy()
    expect(screen.queryByText('Ask on the waiting list.')).toBeNull()
  })
})

describe('which text a burn shows when the list is full', () => {
  it('still says how to pay while fewer than the cap have paid', async () => {
    // The list being full is not the burn being paid full. Paying re-sorts you above
    // every unpaid member, so while places remain unpaid it is still exactly what
    // secures one — and the people above the line who have not paid are the ones the
    // payment instructions are for.
    renderPage(
      stub(
        aRoster({
          event: {
            id: 'e-1',
            name: 'Summer burn',
            member_cap: 2,
            payment_info_markdown: '**Swish** 123',
            transfer_info_markdown: 'Ask on the waiting list.',
          },
          entries: [
            anEntry({ name: 'Ada', payment_status: 'paid' }),
            anEntry({ name: 'Bea', account_id: 'a-1' }),
            anEntry({ name: 'Cyd', waiting: true }),
          ],
        }),
      ),
    )

    expect(await screen.findByText(/Swish/)).toBeTruthy()
    expect(screen.queryByText('Ask on the waiting list.')).toBeNull()
  })
})

describe('what the allergies column shows', () => {
  it('shows the ticked items beside whatever was written', async () => {
    renderPage(
      stub(
        aRoster({
          entries: [anEntry({ name: 'Ada', allergy_items: ['Vegan'], allergies_notes: 'red lentils' })],
        }),
      ),
    )

    expect(await screen.findByText('Vegan, red lentils')).toBeTruthy()
  })

  it('shows the ticks for somebody who wrote nothing', async () => {
    renderPage(stub(aRoster({ entries: [anEntry({ name: 'Ada', allergy_items: ['Lactose'] })] })))

    expect(await screen.findByText('Lactose')).toBeTruthy()
  })
})
