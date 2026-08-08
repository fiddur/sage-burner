import type { Attendance, MyBurn, MyBurnsResponse } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { LocationProvider, useLocation } from 'preact-iso'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from './viewer.tsx'

import { choosableBurns, FetchedBurnProvider, useBurns } from './burn.tsx'
import { ViewerProvider } from './viewer.tsx'

afterEach(cleanup)
// The history outlives one test, and `LocationProvider` reads it on mount.
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

/** Renders the choice as text, so a test can read it without a page. */
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

/**
 * The same, under the router — which is where a link naming a burn is read from.
 *
 * Bare above, because most of these are about what the fetch answers rather than about
 * the URL. `LocationProvider` reads `location` on mount, so the address is set first.
 */
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

/** The line `Shown` draws: status, every burn, and the one selected. */
const shown = () => screen.getByText(/^ready:/).textContent

/** `Shown`, plus the one thing only a router test can do: go somewhere else. */
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
    // The whole of #333: every burn-scoped page reads the selector, so the selector
    // reading the URL is what makes one line's link land on the right page.
    renderChoiceAt('/dreams?burn=e-2', [aBurn('e-1', 'Summer', true), aBurn('e-2', 'Winter', true)])

    // The whole string, as the rest of this file asserts it. `toContain(':Summer')` is
    // true of `ready:Summer,Winter:` whatever is selected, so the two siblings below
    // would pass against no selection at all.
    await waitFor(() => expect(shown()).toBe('ready:Summer,Winter:Winter'))
  })

  it('leaves the default alone when it names one that is not on offer', async () => {
    // A burn the viewer is not coming to, or one that has gone. Falling back to the
    // soonest is what every other page already does with no selection at all.
    renderChoiceAt('/dreams?burn=e-9', [aBurn('e-1', 'Summer', true), aBurn('e-2', 'Winter', true)])

    await waitFor(() => expect(shown()).toBe('ready:Summer,Winter:Summer'))
  })

  it('keeps the burn when the next page names none', async () => {
    // Following a line lands on `/dreams?burn=e-2`, and everything reached from there
    // is a page with no parameter at all. Reading the URL must not mean forgetting the
    // burn the moment somebody moves off the page the link opened.
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
    // The passing sibling: reading the URL must not disturb the ordinary case, which
    // is every page reached from the bar.
    renderChoiceAt('/dreams', [aBurn('e-1', 'Summer', true), aBurn('e-2', 'Winter', true)])

    await waitFor(() => expect(shown()).toBe('ready:Summer,Winter:Summer'))
  })
})

describe('choosableBurns', () => {
  it('gives a member the burns they are coming to, and not the rest', () => {
    const joined = aBurn('e-1', 'Summer', true)
    const other = aBurn('e-2', 'Winter', false)

    expect(choosableBurns(false, [joined, other])).toEqual([joined])
  })

  it('gives an admin every burn still to come', () => {
    // The passing sibling, and the case that matters: an account holding `admin`
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

  it('settles on failed rather than on ready with nothing, when the fetch fails', async () => {
    // #193. It settled on `ready` with an empty list, which is indistinguishable from
    // somebody who has joined no burn — so `NoBurn` told them "you are not coming to a
    // burn yet", a claim about *them*, and pointed them at a page that would not help.
    // Still settled rather than stuck: sitting on "loading" forever would leave every
    // burn-scoped page saying nothing at all.
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
    // #236. `reload` refetched without saying so, leaving "could not load your burns"
    // on screen for the whole of the second attempt — so the button read as broken.
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

    // The passing sibling: it must go back to `loading` and still arrive.
    settle({ coming: [aBurn('e-1', 'Summer', true)], past: [] })
    expect((await screen.findByText(/^ready:/)).textContent).toBe('ready:Summer:Summer')
  })

  it('offers an admin a burn nobody has joined', async () => {
    renderChoice([aBurn('e-1', 'Summer', false)], ADMIN)

    expect((await screen.findByText(/^ready:/)).textContent).toBe('ready:Summer:Summer')
  })
})
