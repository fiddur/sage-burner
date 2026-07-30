import type { Event } from '@sage-burner/shared'

import { cleanup, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'

import { ViewerProvider } from '../viewer.tsx'
import { Home } from './Home.tsx'

afterEach(cleanup)

const summer: Event = {
  id: 'e-1',
  name: 'Summer Burn 2026',
  slug: 'summer-2026',
  start_date: '2026-08-01',
  end_date: '2026-08-05',
  welcome_markdown: '# Bring water\n\nAnd a [map](/map).',
  member_cap: 42,
  created_at: '2026-01-01T00:00:00.000Z',
}

const SIGNED_OUT: Viewer = { status: 'signed-out' }

const renderHome = (event: Event | null, viewer: Viewer = SIGNED_OUT) =>
  render(
    <ViewerProvider viewer={viewer}>
      <Home api={{ getActiveEvent: () => Promise.resolve({ event }) }} />
    </ViewerProvider>,
  )

describe('Home', () => {
  it('renders the active event name and dates', async () => {
    renderHome(summer)

    expect(await screen.findByRole('heading', { name: 'Summer Burn 2026', level: 2 })).toBeTruthy()
    expect(screen.getByText('2026-08-01')).toBeTruthy()
    expect(screen.getByText('2026-08-05')).toBeTruthy()
  })

  it('renders the welcome markdown', async () => {
    // The acceptance criterion for #13: what an organiser typed, on the public
    // page, with no deploy in between.
    renderHome(summer)

    // Level 2: the page's own `h1` is the site name, so content headings shift
    // down one rather than producing a second `h1` under an `h2`.
    expect(await screen.findByRole('heading', { name: 'Bring water', level: 2 })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'map' }).getAttribute('href')).toBe('/map')
  })

  it('escapes raw HTML in the welcome text', async () => {
    // Admin-authored, shown to every visitor — and an admin account is one
    // phished password away from belonging to someone else.
    renderHome({ ...summer, welcome_markdown: 'Hi <script>alert(1)</script>' })

    await screen.findByRole('heading', { name: 'Summer Burn 2026', level: 2 })
    expect(document.querySelector('.welcome script')).toBeNull()
    expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeTruthy()
  })

  it('does not flash "Apply to join" at a member while the viewer loads', async () => {
    // `isMember` is false during `loading`, so without the gate a member sees an
    // invitation to apply to something they are already in, then watches it
    // vanish — a layout shift on the first paint of the public page.
    renderHome(summer, { status: 'loading' })

    expect(screen.queryByRole('link', { name: 'Apply to join' })).toBeNull()
  })

  it('says there is no burn rather than showing nothing', async () => {
    // Before the first event, and again after the last one ends.
    renderHome(null)

    expect(await screen.findByText(/no burn scheduled/i)).toBeTruthy()
  })

  it('says come back later when the API cannot be reached', async () => {
    // Also what an offline first paint looks like, which is why it does not
    // render a code or a stack.
    render(
      <ViewerProvider viewer={SIGNED_OUT}>
        <Home api={{ getActiveEvent: () => Promise.reject(new Error('offline')) }} />
      </ViewerProvider>,
    )

    expect(await screen.findByText(/try again shortly/i)).toBeTruthy()
  })

  it('offers Apply and Log in to a signed-out visitor', async () => {
    renderHome(summer)

    expect((await screen.findByRole('link', { name: 'Apply to join' })).getAttribute('href')).toBe('/apply')
    expect(screen.getByRole('link', { name: 'Log in' }).getAttribute('href')).toBe('/login')
  })

  it('offers Apply before the event has loaded', async () => {
    // Someone who arrived to apply should not wait on a round trip to find the
    // button.
    let resolve: (value: { event: Event | null }) => void = () => undefined
    const pending = new Promise<{ event: Event | null }>((r) => {
      resolve = r
    })
    render(
      <ViewerProvider viewer={SIGNED_OUT}>
        <Home api={{ getActiveEvent: () => pending }} />
      </ViewerProvider>,
    )

    expect(screen.getByRole('link', { name: 'Apply to join' })).toBeTruthy()
    resolve({ event: null })
  })

  it('does not offer Apply to someone who is already a member', async () => {
    renderHome(summer, { status: 'signed-in', account: { id: 'a-1', roles: ['member'] } })

    await screen.findByRole('heading', { name: 'Summer Burn 2026', level: 2 })
    expect(screen.queryByRole('link', { name: 'Apply to join' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Log in' })).toBeNull()
  })

  it('fetches once, not once per render', async () => {
    const getActiveEvent = vi.fn(() => Promise.resolve({ event: summer }))
    // The *same* object both times. A fresh literal per render is a different
    // `api` identity and legitimately refetches — which is why `App` memoises
    // the client. This pins the half that lives here: given a stable client,
    // re-rendering must not refetch.
    const api = { getActiveEvent }

    const { rerender } = render(
      <ViewerProvider viewer={SIGNED_OUT}>
        <Home api={api} />
      </ViewerProvider>,
    )
    await screen.findByRole('heading', { name: 'Summer Burn 2026', level: 2 })

    rerender(
      <ViewerProvider viewer={SIGNED_OUT}>
        <Home api={api} />
      </ViewerProvider>,
    )

    expect(getActiveEvent).toHaveBeenCalledTimes(1)
  })
})
