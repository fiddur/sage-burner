import type { AccountRole } from '@sage-burner/shared'

import { cleanup, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'

import type { Viewer } from '../viewer.tsx'

import { ViewerProvider } from '../viewer.tsx'
import { GuardedPage } from './GuardedPage.tsx'

afterEach(cleanup)

const renderShell = (require: 'admin' | 'approved' | 'member', viewer: Viewer, width?: 'column' | 'full') =>
  render(
    <ViewerProvider viewer={viewer}>
      <GuardedPage title="Places" require={require} {...(width === undefined ? {} : { width })}>
        <h1>Places</h1>
        <p>the content</p>
      </GuardedPage>
    </ViewerProvider>,
  )

const sectionClass = (container: ParentNode) => container.querySelector('section')?.className

const signedInAs = (...roles: AccountRole[]): Viewer => ({
  status: 'signed-in',
  account: { id: 'a-1', name: null, avatar: null, roles },
})

const LOADING: Viewer = { status: 'loading' }
const SIGNED_OUT: Viewer = { status: 'signed-out' }

describe('GuardedPage', () => {
  it('waits while the viewer is still resolving, without deciding either way', () => {
    // Rendering the refusal here would flash "this is not for you" at a member on
    // every page load, before their own roles have come back.
    renderShell('admin', LOADING)

    expect(screen.getByText('One moment…')).toBeTruthy()
    expect(screen.queryByText('the content')).toBeNull()
    expect(screen.queryByText(/ask someone/)).toBeNull()
  })

  it('offers a signed-out visitor a way in, on an admin page as well as a member one', () => {
    // The drift this replaces: five of the nine admin pages told a signed-out
    // visitor to "ask someone who already has admin" — advice for somebody who is
    // already signed in.
    for (const require of ['admin', 'approved', 'member'] as const) {
      const { unmount } = renderShell(require, SIGNED_OUT)

      expect(screen.getByRole('link', { name: 'Log in' }), require).toBeTruthy()
      // And the way in for somebody with no account to log into (#180).
      expect(screen.getByRole('link', { name: 'apply to join' }), require).toBeTruthy()
      expect(screen.queryByText('the content')).toBeNull()
      unmount()
    }
  })

  it('does not offer a login link to somebody already signed in', () => {
    renderShell('admin', signedInAs())

    expect(screen.queryByRole('link', { name: 'Log in' })).toBeNull()
    // Nor the application form: they have an account, so applying for one is not it.
    expect(screen.queryByRole('link', { name: 'apply to join' })).toBeNull()
    expect(screen.getByText(/ask someone who already has access/)).toBeTruthy()
  })

  it('names what the page is for, so the refusal says which access is missing', () => {
    const { unmount } = renderShell('admin', signedInAs('member'))
    expect(screen.getByText(/for admins/)).toBeTruthy()
    unmount()

    renderShell('member', signedInAs())
    expect(screen.getByText(/for members/)).toBeTruthy()
  })

  it('shows the title while refusing, so the page is still recognisable', () => {
    renderShell('admin', signedInAs())

    expect(screen.getByRole('heading', { name: 'Places' })).toBeTruthy()
  })

  it('lets the roles through that each guard is for', () => {
    const cases = [
      { require: 'admin', roles: ['admin'], allowed: true },
      { require: 'admin', roles: ['member'], allowed: false },
      { require: 'member', roles: ['member'], allowed: true },
      { require: 'member', roles: ['admin'], allowed: false },
      // The one that matters: somebody organising but not attending holds `admin`
      // alone, and `requireApproved` on the API lets them in — so this must too, or
      // the page would refuse somebody the server would serve.
      { require: 'approved', roles: ['admin'], allowed: true },
      { require: 'approved', roles: ['member'], allowed: true },
      { require: 'approved', roles: [], allowed: false },
    ] as const

    for (const { require, roles, allowed } of cases) {
      const { unmount } = renderShell(require, signedInAs(...roles))
      const label = `${require} / ${roles.join('+') || 'no roles'}`

      expect(screen.queryByText('the content') !== null, label).toBe(allowed)
      unmount()
    }
  })

  it('renders the page’s own heading rather than a second one', () => {
    // The children carry the `<h1>`; the shell supplies one only while refusing.
    renderShell('member', signedInAs('member'))

    expect(screen.getAllByRole('heading', { name: 'Places' })).toHaveLength(1)
  })

  describe('how wide the page is', () => {
    it('stays unbounded unless asked, so a roster keeps the room', () => {
      // `.site-main` has no max-width on purpose and `.page` carries none, which is what lets
      // the grids and rosters use the window. A default of `column` would squeeze all of them.
      const { container } = renderShell('approved', signedInAs('member'))

      expect(sectionClass(container)).toBe('page')
    })

    it('is a column when the page is fields or cards', () => {
      const { container } = renderShell('approved', signedInAs('member'), 'column')

      expect(sectionClass(container)).toBe('page column')
    })

    it('is the same width while loading and when refused', () => {
      // Otherwise the page jumps sideways as the viewer resolves, or the refusal sits in a
      // different place from the page it replaces.
      const { container: loading } = renderShell('admin', LOADING, 'column')
      expect(sectionClass(loading)).toBe('page column')

      cleanup()

      const { container: refused } = renderShell('admin', signedInAs('member'), 'column')
      expect(sectionClass(refused)).toBe('page column')
    })
  })
})
