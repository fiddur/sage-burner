import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'

import type { NavPage } from './Layout.tsx'

import { Menu } from './Menu.tsx'

afterEach(cleanup)

const RIDES: NavPage[] = [{ href: '/rides', label: 'Rideshares', icon: '🛻' }]

const opened = async (pages: readonly NavPage[] = RIDES) => {
  render(<Menu pages={pages} />)
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
  })

  it('stays open when the press lands inside it', async () => {
    // The success path the test above cannot show: dismissal must be the backdrop's,
    // not everything's.
    fireEvent.pointerDown(await opened())

    expect(screen.queryByRole('link', { name: /Rideshares/ })).toBeTruthy()
  })

  it('closes on following a link, including to the page already open', async () => {
    // There is no route change to react to when the link is where you already are.
    fireEvent.click(await opened())

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
