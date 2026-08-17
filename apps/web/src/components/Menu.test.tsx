import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { LocationProvider } from 'preact-iso'
import { afterEach, describe, expect, it } from 'vitest'

import type { NavPage } from './Layout.tsx'

import { Menu } from './Menu.tsx'

afterEach(cleanup)
afterEach(() => history.replaceState(null, '', '/'))

const RIDES: NavPage[] = [{ href: '/rides', label: 'Rideshares', icon: '🛻' }]

const opened = async (pages: readonly NavPage[] = RIDES, at = '/') => {
  history.replaceState(null, '', at)
  render(
    <LocationProvider>
      <Menu pages={pages} />
      <a href="/members">Members</a>
    </LocationProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Menu' }))

  return await screen.findByRole('link', { name: /Rideshares/ })
}

describe('the menu ahead of the logo', () => {
  it('opens on ☰ and lists what the bar has no room for', async () => {
    expect((await opened()).getAttribute('href')).toBe('/rides')
  })

  it('holds nothing open until it is asked', () => {
    render(<Menu pages={RIDES} />)

    expect(screen.queryByRole('link', { name: /Rideshares/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Menu' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('lets the page go when what it holds falls away under it', async () => {
    const { rerender } = render(<Menu pages={RIDES} />)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    await screen.findByRole('link', { name: /Rideshares/ })

    expect(document.body.style.overflow).toBe('hidden')

    rerender(<Menu pages={[]} />)

    expect(document.body.style.overflow).toBe('')

    rerender(<Menu pages={RIDES} />)

    expect(screen.queryByRole('link', { name: /Rideshares/ })).toBeNull()
    expect(document.body.style.overflow).toBe('')
  })

  it('is not there at all when it would be empty', () => {
    render(<Menu pages={[]} />)

    expect(screen.queryByRole('button', { name: 'Menu' })).toBeNull()
  })

  it('puts itself away when the page behind it is pressed', async () => {
    await opened()
    const backdrop = document.querySelector('.menu-backdrop')

    expect(backdrop).not.toBeNull()
    if (backdrop !== null) fireEvent.pointerDown(backdrop)

    await waitFor(() => expect(screen.queryByRole('link', { name: /Rideshares/ })).toBeNull())
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Menu' }))
  })

  it('stays open when the press lands inside it', async () => {
    fireEvent.pointerDown(await opened())

    expect(screen.queryByRole('link', { name: /Rideshares/ })).toBeTruthy()
  })

  it('closes on following a link to the page already open', async () => {
    fireEvent.click(await opened(RIDES, '/rides'))

    await waitFor(() => expect(screen.queryByRole('link', { name: /Rideshares/ })).toBeNull())
    expect(location.pathname).toBe('/rides')
  })

  it('closes when the route changes under it', async () => {
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
    await opened()

    fireEvent.click(screen.getByRole('button', { name: /Close/ }))

    await waitFor(() => expect(screen.queryByRole('link', { name: /Rideshares/ })).toBeNull())
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
    await opened()
    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(document.querySelectorAll('.menu-drawer a')).toHaveLength(0))
  })
})
