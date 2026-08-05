import type { Attendance, MyBurn } from '@sage-burner/shared'

import { cleanup, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from './viewer.tsx'

import { choosableBurns, FetchedBurnProvider, useBurns } from './burn.tsx'
import { ViewerProvider } from './viewer.tsx'

afterEach(cleanup)

const anAttendance = (): Attendance => ({
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
})

const aBurn = (id: string, name: string, joined: boolean): MyBurn => ({
  event: {
    id,
    name,
    slug: name.toLowerCase(),
    start_date: '2026-08-01',
    end_date: '2026-08-05',
    start_time: '16:00',
    end_time: '12:00',
  },
  attendance: joined ? anAttendance() : null,
})

const MEMBER: Viewer = {
  status: 'signed-in',
  account: { id: 'a-1', name: null, avatar: null, roles: ['member'] },
}
const ORGANISER: Viewer = {
  status: 'signed-in',
  account: { id: 'a-2', name: null, avatar: null, roles: ['admin'] },
}

/** Renders the choice as text, so a test can read it without a page. */
const Shown = () => {
  const { status, burns, selected } = useBurns()

  return (
    <p>
      {status}:{burns.map((burn) => burn.event.name).join(',')}:{selected?.event.name ?? 'none'}
    </p>
  )
}

const renderChoice = (coming: MyBurn[], viewer: Viewer = MEMBER) => {
  const getMyBurns = vi.fn(() => Promise.resolve({ coming, past: [] }))
  render(
    <ViewerProvider viewer={viewer}>
      <FetchedBurnProvider api={{ getMyBurns }}>
        <Shown />
      </FetchedBurnProvider>
    </ViewerProvider>,
  )

  return getMyBurns
}

describe('choosableBurns', () => {
  it('gives a member the burns they are coming to, and not the rest', () => {
    const joined = aBurn('e-1', 'Summer', true)
    const other = aBurn('e-2', 'Winter', false)

    expect(choosableBurns(false, [joined, other])).toEqual([joined])
  })

  it('gives an organiser every burn still to come', () => {
    // The passing sibling, and the case that matters: an organiser holding `admin`
    // without `member` has no attendance anywhere, so the member rule would leave
    // them with an empty selector on the burn they are setting up.
    const joined = aBurn('e-1', 'Summer', true)
    const other = aBurn('e-2', 'Winter', false)

    expect(choosableBurns(true, [joined, other])).toEqual([joined, other])
  })
})

describe('the burn choice', () => {
  it('defaults to the soonest, since the list arrives soonest first', async () => {
    renderChoice([aBurn('e-1', 'Summer', true), aBurn('e-2', 'Winter', true)])

    expect((await screen.findByText(/^ready:/)).textContent).toBe('ready:Summer,Winter:Summer')
  })

  it('is ready with nothing for somebody who is coming to none', async () => {
    // Their details page is where they join one. Sitting on "loading" forever would
    // leave every burn-scoped page saying nothing at all.
    renderChoice([aBurn('e-1', 'Summer', false)])

    expect((await screen.findByText(/^ready:/)).textContent).toBe('ready::none')
  })

  it('asks nothing at all for somebody with no roles', async () => {
    const getMyBurns = renderChoice([], {
      status: 'signed-in',
      account: { id: 'a-9', name: null, avatar: null, roles: [] },
    })

    await screen.findByText(/^ready:/)
    expect(getMyBurns).not.toHaveBeenCalled()
  })

  it('is ready rather than stuck when the fetch fails', async () => {
    // Each page reports its own failure to load; the bar showing an empty selector
    // forever would be a second, worse way of saying the same thing.
    render(
      <ViewerProvider viewer={MEMBER}>
        <FetchedBurnProvider api={{ getMyBurns: () => Promise.reject(new Error('nope')) }}>
          <Shown />
        </FetchedBurnProvider>
      </ViewerProvider>,
    )

    await waitFor(() => expect(screen.getByText(/^ready:/).textContent).toBe('ready::none'))
  })

  it('offers an organiser a burn nobody has joined', async () => {
    renderChoice([aBurn('e-1', 'Summer', false)], ORGANISER)

    expect((await screen.findByText(/^ready:/)).textContent).toBe('ready:Summer:Summer')
  })
})
