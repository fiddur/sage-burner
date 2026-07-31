import { cleanup, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppApi } from './app.tsx'
import type { Viewer } from './viewer.tsx'

import { App } from './app.tsx'

/**
 * A stub satisfying exactly what `App` declares it needs — a plain object, no
 * cast.
 *
 * This was `as unknown as ApiClient`, which is the double cast the standards
 * are aimed at: through `unknown` the object stops being checked against the
 * type at all, so it would have survived `App` calling a method the stub does
 * not have. The two unused entries reject rather than resolve, so a test that
 * comes to depend on them fails loudly instead of quietly seeing a null viewer.
 */
const clientWith = (
  logout: AppApi['logout'] = () => Promise.reject(new Error('logout is not stubbed in this file')),
): AppApi => ({
  logout,
  getMe: () => Promise.reject(new Error('getMe is not stubbed in this file')),
  login: () => Promise.reject(new Error('login is not stubbed in this file')),
  getAdminAccounts: () => Promise.reject(new Error('getAdminAccounts is not stubbed in this file')),
  getQuestions: () => Promise.resolve({ questions: [] }),
  addQuestion: () => Promise.reject(new Error('addQuestion is not stubbed in this file')),
  updateQuestion: () => Promise.reject(new Error('updateQuestion is not stubbed in this file')),
  deleteQuestion: () => Promise.reject(new Error('deleteQuestion is not stubbed in this file')),
  reorderQuestions: () => Promise.reject(new Error('reorderQuestions is not stubbed in this file')),
  getEvents: () => Promise.reject(new Error('getEvents is not stubbed in this file')),
  createEvent: () => Promise.reject(new Error('createEvent is not stubbed in this file')),
  updateEvent: () => Promise.reject(new Error('updateEvent is not stubbed in this file')),
  getActiveEvent: () => Promise.resolve({ event: null }),
})

/**
 * Mounts the real `App` — its route table, its layout, its providers — rather
 * than a copy of them. A route added, removed or repointed in app.tsx must be
 * able to fail here, which a re-declared table could not do.
 */

/**
 * Signed-out by default, and always explicit — in both arguments.
 *
 * Omitting `viewer` selects the provider that asks the API — which is right for
 * the app and wrong for a suite, where it would mean every render reaching for
 * `fetch`. `viewer.test.tsx` covers that provider directly with an injected
 * client.
 *
 * `api` was omitted here for the same reason it should not have been. That
 * builds a real `createApiClient()`, and once `Home` began fetching on mount,
 * `renderAt('/')` issued a genuine `fetch('/api/events/active')` — resolved by
 * happy-dom against vitest's document URL, so an actual connection to
 * `localhost:3000`, which is also the dev proxy target. On a machine with the
 * backend running, this unit suite was talking to the live API. Nothing failed,
 * because `Home` catches and the unmount abort swallowed the late `setState` —
 * which is why it went unnoticed rather than why it was fine.
 */
const renderAt = (path: string, viewer: Viewer = { status: 'signed-out' }) => {
  window.history.replaceState(null, '', path)

  return render(<App viewer={viewer} api={clientWith()} />)
}

/**
 * The network is closed to this file, and the closure is checked.
 *
 * Stubbing `api` fixes today's leak; this fails the *next* one — a route added
 * to `app.tsx` that fetches on mount, a component reaching past its injected
 * client. Both would otherwise reproduce exactly the silence described above.
 *
 * It has to be an assertion rather than only a rejecting stub, because the
 * pages catch their own fetch failures: a stub that rejects is indistinguishable
 * to the suite from one that is never called.
 */
let fetches: string[] = []

beforeEach(() => {
  fetches = []
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    fetches.push(String(input instanceof Request ? input.url : input))
    return Promise.reject(new Error('the unit suite must not reach the network'))
  })
})

afterEach(() => {
  // Explicit because the library's automatic cleanup only registers itself
  // when vitest globals are on, and they are off here. Without it every render
  // stacks in the same document and the nav assertions below see links from
  // earlier tests.
  cleanup()
  window.history.replaceState(null, '', '/')

  // After `cleanup()`, so a request fired during unmount counts too.
  const attempted = fetches
  vi.restoreAllMocks()
  expect(attempted).toEqual([])
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
