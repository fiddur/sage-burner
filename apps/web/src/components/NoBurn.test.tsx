import { cleanup, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'

import type { BurnChoice } from '../burn.tsx'
import type { Viewer } from '../viewer.tsx'

import { BurnProvider } from '../burn.tsx'
import { ViewerProvider } from '../viewer.tsx'
import { NoBurn } from './NoBurn.tsx'

afterEach(cleanup)

const MEMBER: Viewer = {
  status: 'signed-in',
  account: { id: 'a-1', name: null, avatar: null, roles: ['member'] },
}
const ADMIN: Viewer = {
  status: 'signed-in',
  account: { id: 'a-2', name: null, avatar: null, roles: ['admin'] },
}

const renderIt = (choice: BurnChoice, viewer: Viewer = MEMBER) =>
  render(
    <ViewerProvider viewer={viewer}>
      <BurnProvider value={choice}>
        <NoBurn absent="there is no grid to lay out" />
      </BurnProvider>
    </ViewerProvider>,
  )

const LOADING: BurnChoice = { status: 'loading', burns: [], selected: undefined }
const NONE: BurnChoice = { status: 'ready', burns: [], selected: undefined }
const FAILED: BurnChoice = { status: 'failed', burns: [], selected: undefined }

describe('NoBurn', () => {
  it('says the fetch failed rather than telling a member they are coming to nothing', () => {
    // #193. A failed fetch and "you have joined no burn" both left the selector empty,
    // so the copy made a claim about the *reader* that was false whenever the request
    // was the thing that broke — and sent them to a page that could not help.
    renderIt(FAILED)

    // The whole sentence, not a prefix of it. `toContain('Could not load your burns')`
    // passed against a version that rendered the literal text `{absent}`, because the
    // part it checked came before the hole.
    expect(screen.getByRole('alert').textContent).toBe(
      'Could not load your burns, so there is no grid to lay out. Please reload the page.',
    )
    expect(screen.queryByText(/not coming to a burn/)).toBeNull()
  })

  it('says the same to an admin, the failure not being about who is reading it', () => {
    renderIt(FAILED, ADMIN)

    expect(screen.getByRole('alert').textContent).toBe(
      'Could not load your burns, so there is no grid to lay out. Please reload the page.',
    )
    expect(screen.queryByText(/no burn planned/)).toBeNull()
  })

  it('waits rather than claiming there is no burn while the burns are still arriving', async () => {
    // The bug this component was extracted for. The burns are fetched once for the
    // whole session, so a page mounted before they land saw no selected burn and
    // stated it as fact, then corrected itself — a flash of a wrong claim where a
    // "Loading…" belonged.
    renderIt(LOADING)

    expect(await screen.findByText('Loading…')).toBeTruthy()
    expect(screen.queryByText(/no burn planned/)).toBeNull()
    expect(screen.queryByText(/not coming to a burn/)).toBeNull()
  })

  it('tells an admin none is planned, and where to make one', async () => {
    // They are offered every burn still to come, so an empty selector means there
    // is none — and the fix is theirs.
    renderIt(NONE, ADMIN)

    expect(await screen.findByText(/no burn planned yet/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Events' }).getAttribute('href')).toBe('/admin/events')
  })

  it('tells a member they have not joined one, and where to', async () => {
    // They are offered the burns they have joined, so an empty selector usually
    // means they have not joined — not that none exists. The old copy said the
    // latter, which is a claim about the world rather than about them.
    renderIt(NONE)

    expect(await screen.findByText(/not coming to a burn yet/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Your details' }).getAttribute('href')).toBe('/profile')
  })

  it('carries the page’s own words for what is missing', async () => {
    renderIt(NONE)

    expect(await screen.findByText(/there is no grid to lay out/)).toBeTruthy()
  })
})
