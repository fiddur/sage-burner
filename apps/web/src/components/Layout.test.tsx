import type { AccountRole } from '@sage-burner/shared'

import { cleanup, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'

import type { Viewer } from '../viewer.tsx'

import { InstallationProvider } from '../installation.tsx'
import { ViewerProvider } from '../viewer.tsx'
import { Layout } from './Layout.tsx'

afterEach(cleanup)

const never = () => Promise.reject(new Error('logout is not stubbed here'))

const renderNav = (viewer: Viewer) =>
  render(
    <InstallationProvider title="Sage Burner">
      <ViewerProvider viewer={viewer}>
        <Layout api={{ logout: never }}>
          <p>the page</p>
        </Layout>
      </ViewerProvider>
    </InstallationProvider>,
  )

const signedInAs = (...roles: AccountRole[]): Viewer => ({
  status: 'signed-in',
  account: { id: 'a-1', roles },
})

const links = () => screen.getAllByRole('link').map((link) => link.textContent)

/**
 * Asserted one at a time, never as a negated `arrayContaining`.
 *
 * `expect(links).not.toEqual(expect.arrayContaining(['a', 'b', 'c']))` passes when
 * *any one* of the three is absent — measured, not assumed — so a test written that
 * way stays green while two of the three leak. Every absence here names one link.
 */
const expectLinks = (present: string[], absent: string[]) => {
  const shown = links()
  for (const label of present) expect(shown, `${label} should be offered`).toContain(label)
  for (const label of absent) expect(shown, `${label} should not be offered`).not.toContain(label)
}

describe('the nav', () => {
  it('offers a signed-out visitor the way in, and none of the pages behind it', () => {
    renderNav({ status: 'signed-out' })

    expectLinks(['Apply', 'Log in'], ['Your burn', 'Dreams', 'Schedule', 'Roles', 'Your details'])
  })

  it('gives a member their own pages and the shared ones', () => {
    renderNav(signedInAs('member'))

    expectLinks(['Your burn', 'Dreams', 'Schedule', 'Roles', 'Your details'], [])
  })

  it('reaches the shared pages for an organiser who holds admin alone', () => {
    // Schedule and Roles are `requireApproved` server-side, so an organiser who is
    // not attending may use them — and used to be able to only by typing the URL,
    // because the nav gated them on `member`. The personal pages stay behind
    // `member`, since somebody not attending has no stay to fill in.
    renderNav(signedInAs('admin'))

    expectLinks(['Schedule', 'Roles', 'Organise'], ['Your burn', 'Your details'])
  })

  it('offers an account with no roles none of them', () => {
    // An applicant with an account, waiting on a decision. Every link named, because
    // this is the case where a leak would matter.
    renderNav(signedInAs())

    expectLinks([], ['Your burn', 'Dreams', 'Schedule', 'Roles', 'Your details', 'Organise'])
  })
})
