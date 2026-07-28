import { cleanup, render, screen } from '@testing-library/preact'
import { LocationProvider, Route, Router } from 'preact-iso'
import { afterEach, describe, expect, it } from 'vitest'

import type { Session } from './session.tsx'

import { Layout } from './components/Layout.tsx'
import { Home } from './pages/Home.tsx'
import { NotFound } from './pages/NotFound.tsx'
import { SessionProvider } from './session.tsx'

/**
 * Mounts the real routing and layout rather than asserting on props, so a
 * broken route or a nav that shows the wrong links actually fails.
 */

const renderAt = (path: string, session?: Session) => {
  window.history.replaceState(null, '', path)

  return render(
    <LocationProvider>
      <SessionProvider session={session}>
        <Layout>
          <Router>
            <Route path="/" component={Home} />
            <Route default component={NotFound} />
          </Router>
        </Layout>
      </SessionProvider>
    </LocationProvider>,
  )
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
      account: { id: 'a1', email: 'someone@example.org', roles: ['member'] },
    })

    expect(linkNames()).toContain('My details')
    expect(linkNames()).toContain('Schedule')
    expect(linkNames()).not.toContain('Log in')
    expect(linkNames()).not.toContain('Organise')
  })

  it('offers the organising pages to an admin', () => {
    renderAt('/', {
      status: 'signed-in',
      account: { id: 'a1', email: 'admin@example.org', roles: ['admin', 'member'] },
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
