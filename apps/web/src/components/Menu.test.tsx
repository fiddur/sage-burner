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

  it('puts itself away when something else on the page is pressed', async () => {
    await opened()

    fireEvent.pointerDown(document.body)

    await waitFor(() => expect(screen.queryByRole('link', { name: /Rideshares/ })).toBeNull())
  })

  it('stays open when the press lands inside it', async () => {
    // The success path the test above cannot show: ☰ is itself a press inside, so a
    // listener that did not check would fight its own toggle.
    fireEvent.pointerDown(await opened())

    expect(screen.queryByRole('link', { name: /Rideshares/ })).toBeTruthy()
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
