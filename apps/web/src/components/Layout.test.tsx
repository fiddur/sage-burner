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

describe('the nav', () => {
  it('offers a signed-out visitor the public entry points and nothing else', () => {
    renderNav({ status: 'signed-out' })

    expect(links()).toEqual(expect.arrayContaining(['Apply', 'Log in']))
    expect(links()).not.toEqual(expect.arrayContaining(['Your burn', 'Roles']))
  })

  it('gives a member their own pages', () => {
    renderNav(signedInAs('member'))

    expect(links()).toEqual(expect.arrayContaining(['Your burn', 'Dreams', 'Your details']))
  })

  it('reaches the shared pages for an organiser who holds admin alone', () => {
    // Schedule and Roles are `requireApproved` server-side, so an organiser who is
    // not attending may use them — and used to be able to only by typing the URL,
    // because the nav gated them on `member`.
    renderNav(signedInAs('admin'))

    expect(links()).toEqual(expect.arrayContaining(['Schedule', 'Roles', 'Organise']))
  })

  it('keeps the personal pages to members, since an organiser has no stay', () => {
    renderNav(signedInAs('admin'))

    expect(links()).not.toEqual(expect.arrayContaining(['Your burn']))
    expect(links()).not.toEqual(expect.arrayContaining(['Your details']))
  })

  it('offers a member the shared pages too', () => {
    renderNav(signedInAs('member'))

    expect(links()).toEqual(expect.arrayContaining(['Schedule', 'Roles']))
  })

  it('offers nothing but the public entry points to an account with no roles', () => {
    // An applicant with an account, waiting on a decision.
    renderNav(signedInAs())

    expect(links()).not.toEqual(expect.arrayContaining(['Schedule', 'Roles', 'Organise']))
  })
})
