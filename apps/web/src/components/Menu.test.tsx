import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { LocationProvider } from 'preact-iso'
import { afterEach, describe, expect, it } from 'vitest'

import type { NavPage } from './Layout.tsx'

import { Menu } from './Menu.tsx'

afterEach(cleanup)
// The history outlives one test, and `LocationProvider` reads it on mount.
afterEach(() => history.replaceState(null, '', '/'))

const RIDES: NavPage[] = [{ href: '/rides', label: 'Rideshares', icon: '🛻' }]

/**
 * Inside a `LocationProvider`, so `useLocation().path` is the address rather than the
 * empty default context — which is what makes the close-on-route-change effect run at
 * all. `at` is where the drawer is opened from, so a test can tell following a link
 * *elsewhere* from following one to the page already open.
 */
const opened = async (pages: readonly NavPage[] = RIDES, at = '/') => {
  history.replaceState(null, '', at)
  render(
    <LocationProvider>
      <Menu pages={pages} />
      <a href="/members">Members</a>
    </LocationProvider>,
  )
  // `fireEvent` rather than `.click()`, because it runs inside `act` — which is what
  // flushes the effect attaching the dismissal listeners.
  fireEvent.click(screen.getByRole('button', { name: 'Menu' }))

  return await screen.findByRole('link', { name: /Rideshares/ })
}

describe('the menu beside the logo', () => {
  it('opens on ☰ and lists what the bar has no room for', async () => {
    expect((await opened()).getAttribute('href')).toBe('/rides')
  })

  it('holds nothing open until it is asked', () => {
    render(<Menu pages={RIDES} />)

    expect(screen.queryByRole('link', { name: /Rideshares/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Menu' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('lets the page go when what it holds falls away under it', async () => {
    // Roles lost on a background 401 while the drawer is out. The early return stops
    // rendering it, and a lock that outlived it would leave a page nobody can scroll
    // and nothing on screen to explain why (#311).
    const { rerender } = render(<Menu pages={RIDES} />)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    await screen.findByRole('link', { name: /Rideshares/ })

    expect(document.body.style.overflow).toBe('hidden')

    rerender(<Menu pages={[]} />)

    expect(document.body.style.overflow).toBe('')

    // And it does not spring open again when they come back: `open` is state, and
    // nothing between here and there was a press.
    rerender(<Menu pages={RIDES} />)

    expect(screen.queryByRole('link', { name: /Rideshares/ })).toBeNull()
    expect(document.body.style.overflow).toBe('')
  })

  it('is not there at all when it would be empty', () => {
    // A signed-out visitor. A control that opens onto nothing is furniture.
    render(<Menu pages={[]} />)

    expect(screen.queryByRole('button', { name: 'Menu' })).toBeNull()
  })

  it('puts itself away when the page behind it is pressed', async () => {
    // The backdrop, not `document.body`. It covers the viewport, so it *is* what a
    // press outside the drawer lands on — and `fireEvent.pointerDown(document.body)`
    // sets the target directly, so it never goes through the element a person hits.
    await opened()
    const backdrop = document.querySelector('.menu-backdrop')

    expect(backdrop).not.toBeNull()
    if (backdrop !== null) fireEvent.pointerDown(backdrop)

    await waitFor(() => expect(screen.queryByRole('link', { name: /Rideshares/ })).toBeNull())
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Menu' }))
  })

  it('stays open when the press lands inside it', async () => {
    // The success path the test above cannot show: dismissal must be the backdrop's,
    // not everything's.
    fireEvent.pointerDown(await opened())

    expect(screen.queryByRole('link', { name: /Rideshares/ })).toBeTruthy()
  })

  it('closes on following a link to the page already open', async () => {
    // Opened *from* `/rides`, so the router has no route change to give the effect —
    // the link's own handler is the only thing that can close it.
    fireEvent.click(await opened(RIDES, '/rides'))

    await waitFor(() => expect(screen.queryByRole('link', { name: /Rideshares/ })).toBeNull())
    expect(location.pathname).toBe('/rides')
  })

  it('closes when the route changes under it', async () => {
    // A link outside the drawer: the drawer covers the page, but nothing in this suite
    // lays anything out, and what is under test is the effect watching the address.
    await opened()

    fireEvent.click(screen.getByRole('link', { name: 'Members' }))

    await waitFor(() => expect(location.pathname).toBe('/members'))
    await waitFor(() => expect(screen.queryByRole('link', { name: /Rideshares/ })).toBeNull())
  })

  it('moves focus into the drawer when it opens', async () => {
    const entry = await opened()

    await waitFor(() => expect(document.activeElement).toBe(entry))
  })

  it('closes on ✕, which is the way out the drawer does not cover', async () => {
    // The drawer is drawn over ☰, so pressing ☰ again is not available to a pointer.
    await opened()

    fireEvent.click(screen.getByRole('button', { name: /Close/ }))

    await waitFor(() => expect(screen.queryByRole('link', { name: /Rideshares/ })).toBeNull())
    // Focus was inside the drawer, and closing unmounts it.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Menu' }))
  })

  it('closes on Escape and hands focus back to ☰', async () => {
    await opened()

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('link', { name: /Rideshares/ })).toBeNull())
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Menu' }))
  })

  it('ignores a key that is not Escape', async () => {
    await opened()

    fireEvent.keyDown(document, { key: 'Enter' })

    expect(screen.queryByRole('link', { name: /Rideshares/ })).toBeTruthy()
  })

  it('leaves the links out of the tab order while it is shut', async () => {
    // Rendered only while open rather than hidden with CSS, so there is nothing to
    // reach by tabbing and no `inert` to keep in step with the animation.
    await opened()
    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(document.querySelectorAll('.menu-drawer a')).toHaveLength(0))
  })
})
