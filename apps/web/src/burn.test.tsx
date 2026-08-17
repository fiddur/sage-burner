import type { Attendance, MyBurn, MyBurnsResponse } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { LocationProvider, useLocation } from 'preact-iso'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from './viewer.tsx'

import { choosableBurns, FetchedBurnProvider, useBurns } from './burn.tsx'
import { ViewerProvider } from './viewer.tsx'

afterEach(cleanup)
afterEach(() => history.replaceState(null, '', '/'))

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
const ADMIN: Viewer = {
  status: 'signed-in',
  account: { id: 'a-2', name: null, avatar: null, roles: ['admin'] },
}

const Shown = () => {
  const { status, burns, selected, reload } = useBurns()

  return (
    <>
      <p>
        {status}:{burns.map((burn) => burn.event.name).join(',')}:{selected?.event.name ?? 'none'}
      </p>
      <button type="button" onClick={reload}>
        Try again
      </button>
    </>
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

const renderChoiceAt = (at: string, coming: MyBurn[], viewer: Viewer = MEMBER) => {
  history.replaceState(null, '', at)
  const getMyBurns = vi.fn(() => Promise.resolve({ coming, past: [] }))
  render(
    <LocationProvider>
      <ViewerProvider viewer={viewer}>
        <FetchedBurnProvider api={{ getMyBurns }}>
          <Shown />
        </FetchedBurnProvider>
      </ViewerProvider>
    </LocationProvider>,
  )

  return getMyBurns
}

const shown = () => screen.getByText(/^ready:/).textContent

const Travelling = () => {
  const { route } = useLocation()

  return (
    <>
      <Shown />
      <button type="button" onClick={() => route('/members')}>
        Go to Members
      </button>
    </>
  )
}

describe('a link that names a burn', () => {
  it('chooses it, rather than leaving the selector where it was', async () => {
    renderChoiceAt('/dreams?burn=e-2', [aBurn('e-1', 'Summer', true), aBurn('e-2', 'Winter', true)])

    await waitFor(() => expect(shown()).toBe('ready:Summer,Winter:Winter'))
  })

  it('leaves the default alone when it names one that is not on offer', async () => {
    renderChoiceAt('/dreams?burn=e-9', [aBurn('e-1', 'Summer', true), aBurn('e-2', 'Winter', true)])

    await waitFor(() => expect(shown()).toBe('ready:Summer,Winter:Summer'))
  })

  it('keeps the burn when the next page names none', async () => {
    history.replaceState(null, '', '/dreams?burn=e-2')
    render(
      <LocationProvider>
        <ViewerProvider viewer={MEMBER}>
          <FetchedBurnProvider
            api={{
              getMyBurns: () =>
                Promise.resolve({
                  coming: [aBurn('e-1', 'Summer', true), aBurn('e-2', 'Winter', true)],
                  past: [],
                }),
            }}
          >
            <Travelling />
          </FetchedBurnProvider>
        </ViewerProvider>
      </LocationProvider>,
    )
    await waitFor(() => expect(shown()).toBe('ready:Summer,Winter:Winter'))

    fireEvent.click(screen.getByRole('button', { name: 'Go to Members' }))

    await waitFor(() => expect(location.pathname).toBe('/members'))
    expect(shown()).toBe('ready:Summer,Winter:Winter')
  })

  it('leaves the default alone when there is no such parameter', async () => {
    renderChoiceAt('/dreams', [aBurn('e-1', 'Summer', true), aBurn('e-2', 'Winter', true)])

    await waitFor(() => expect(shown()).toBe('ready:Summer,Winter:Summer'))
  })
})

describe('choosableBurns', () => {
  it('offers every coming burn, joined or not, so watching from the side reaches the pages', () => {
    const joined = aBurn('e-1', 'Summer', true)
    const other = aBurn('e-2', 'Winter', false)

    expect(choosableBurns([joined, other])).toEqual([joined, other])
  })

  it('puts the joined ones first, whatever order they arrived in', () => {
    const joined = aBurn('e-2', 'Winter', true)
    const other = aBurn('e-1', 'Summer', false)

    expect(choosableBurns([other, joined])).toEqual([joined, other])
  })

  it('holds the order the API sent within each half, which is soonest first', () => {
    const joinedSoon = aBurn('e-1', 'Summer', true)
    const joinedLater = aBurn('e-3', 'Autumn', true)
    const soon = aBurn('e-2', 'Winter', false)
    const later = aBurn('e-4', 'Spring', false)

    expect(choosableBurns([joinedSoon, soon, joinedLater, later])).toEqual([
      joinedSoon,
      joinedLater,
      soon,
      later,
    ])
  })
})

describe('the burn choice', () => {
  it('defaults to the soonest, since the list arrives soonest first', async () => {
    renderChoice([aBurn('e-1', 'Summer', true), aBurn('e-2', 'Winter', true)])

    expect((await screen.findByText(/^ready:/)).textContent).toBe('ready:Summer,Winter:Summer')
  })

  it('offers the coming burn to somebody who has joined none, rather than nothing', async () => {
    renderChoice([aBurn('e-1', 'Summer', false)])

    expect((await screen.findByText(/^ready:/)).textContent).toBe('ready:Summer:Summer')
  })

  it('is ready with nothing when no burn is coming at all', async () => {
    renderChoice([])

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

  it('settles on failed rather than on ready with nothing, when the fetch fails', async () => {
    render(
      <ViewerProvider viewer={MEMBER}>
        <FetchedBurnProvider api={{ getMyBurns: () => Promise.reject(new Error('nope')) }}>
          <Shown />
        </FetchedBurnProvider>
      </ViewerProvider>,
    )

    await waitFor(() => expect(screen.getByText(/^failed:/).textContent).toBe('failed::none'))
  })

  it('goes back to loading while a retry is in flight', async () => {
    let settle: (response: MyBurnsResponse) => void = () => undefined
    const getMyBurns = vi
      .fn<() => Promise<MyBurnsResponse>>()
      .mockRejectedValueOnce(new Error('nope'))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            settle = resolve
          }),
      )

    render(
      <ViewerProvider viewer={MEMBER}>
        <FetchedBurnProvider api={{ getMyBurns }}>
          <Shown />
        </FetchedBurnProvider>
      </ViewerProvider>,
    )
    await waitFor(() => expect(screen.getByText(/^failed:/)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(screen.getByText(/^loading:/)).toBeTruthy()

    settle({ coming: [aBurn('e-1', 'Summer', true)], past: [] })
    expect((await screen.findByText(/^ready:/)).textContent).toBe('ready:Summer:Summer')
  })

  it('offers an admin a burn nobody has joined', async () => {
    renderChoice([aBurn('e-1', 'Summer', false)], ADMIN)

    expect((await screen.findByText(/^ready:/)).textContent).toBe('ready:Summer:Summer')
  })
})
