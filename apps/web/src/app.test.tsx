import { cleanup, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ApiClient } from './api/client.ts'
import type { Viewer } from './viewer.tsx'

import { App } from './app.tsx'

/**
 * Only the methods the layout reaches for. Typed through `ApiClient` so a
 * rename there fails here rather than silently leaving this stub behind.
 */
const clientWith = (logout: ApiClient['logout']) => ({ logout }) as unknown as ApiClient

/**
 * Mounts the real `App` — its route table, its layout, its providers — rather
 * than a copy of them. A route added, removed or repointed in app.tsx must be
 * able to fail here, which a re-declared table could not do.
 */

/**
 * Signed-out by default, and always explicit.
 *
 * Omitting `viewer` selects the provider that asks the API — which is right for
 * the app and wrong for a suite, where it would mean every render reaching for
 * `fetch`. `viewer.test.tsx` covers that provider directly with an injected
 * client.
 */
const renderAt = (path: string, viewer: Viewer = { status: 'signed-out' }) => {
  window.history.replaceState(null, '', path)

  return render(<App viewer={viewer} />)
}

afterEach(() => {
  // Explicit because the library's automatic cleanup only registers itself
  // when vitest globals are on, and they are off here. Without it every render
  // stacks in the same document and the nav assertions below see links from
  // earlier tests.
  cleanup()
  window.history.replaceState(null, '', '/')
})

describe('routing', () => {
  it('renders the home page at the root', () => {
    renderAt('/')

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sage Burner')
  })

  it('falls back to a not-found page for an unknown route', () => {
    renderAt('/no/such/page')

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Nothing here')
  })

  it('explains expired invites on the not-found page, since that is how people arrive there', () => {
    renderAt('/invite/an-expired-token')

    expect(screen.getByRole('article').textContent).toContain('single-use')
  })
})

describe('signing out', () => {
  it('offers a log-out control only when signed in, and clears the viewer', async () => {
    const logout = vi.fn(() => Promise.resolve({ viewer: null }))
    render(
      <App
        viewer={{ status: 'signed-in', account: { id: 'a-1', roles: ['member'] } }}
        api={clientWith(logout)}
      />,
    )

    screen.getByRole('button', { name: 'Log out' }).click()

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull())
    expect(logout).toHaveBeenCalledTimes(1)
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toContain('Log in')
  })

  it('clears the viewer even when the logout request fails', async () => {
    // A nav still saying "Log out" after a failed request is worse than one
    // that says signed-out while a stale cookie expires on its own.
    const logout = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    render(
      <App
        viewer={{ status: 'signed-in', account: { id: 'a-1', roles: ['member'] } }}
        api={clientWith(logout)}
      />,
    )

    screen.getByRole('button', { name: 'Log out' }).click()

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull())
  })
})

describe('navigation', () => {
  const linkNames = () =>
    screen
      .getAllByRole('link')
      .map((link) => link.textContent?.trim())
      .filter((text): text is string => text !== undefined)

  it('offers the public entry points when signed out', () => {
    renderAt('/')

    expect(linkNames()).toContain('Apply')
    expect(linkNames()).toContain('Log in')
    expect(linkNames()).not.toContain('My details')
    expect(linkNames()).not.toContain('Organise')
  })

  it('offers member pages once signed in, and drops the public ones', () => {
    renderAt('/', {
      status: 'signed-in',
      account: { id: 'a1', roles: ['member'] },
    })

    expect(linkNames()).toContain('My details')
    expect(linkNames()).toContain('Schedule')
    expect(linkNames()).not.toContain('Log in')
    expect(linkNames()).not.toContain('Organise')
  })

  it('offers the organising pages to an admin', () => {
    renderAt('/', {
      status: 'signed-in',
      account: { id: 'a1', roles: ['admin', 'member'] },
    })

    expect(linkNames()).toContain('Organise')
    expect(linkNames()).toContain('My details')
  })

  it('shows nothing role-specific while the session is still loading', () => {
    // Otherwise the nav flickers from signed-out to signed-in on every load,
    // which reads as a bug and is worse than showing less for a moment.
    renderAt('/', { status: 'loading' })

    expect(linkNames()).not.toContain('Log in')
    expect(linkNames()).not.toContain('My details')
    expect(linkNames()).not.toContain('Organise')
  })
})
