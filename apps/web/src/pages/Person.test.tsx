import type { Connection, PersonProfile } from '@sage-burner/shared'

import { cleanup, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { PersonApi } from './Person.tsx'

import { apiError } from '../api/client.ts'
import { ViewerProvider } from '../viewer.tsx'
import { nameOf, Person } from './Person.tsx'

afterEach(cleanup)

const ANNA: Viewer = {
  status: 'signed-in',
  account: { id: 'a-1', name: 'Anna', avatar: null, roles: ['member'] },
}

const aWay = (over: Partial<Connection> & Pick<Connection, 'id' | 'kind' | 'value'>): Connection => ({
  account_id: 'a-2',
  label: '',
  order: 0,
  ...over,
})

const aPerson = (over: Partial<PersonProfile> = {}): PersonProfile => ({
  account_id: 'a-2',
  name: 'Wren Aldertide',
  avatar: null,
  connections: [],
  contact: null,
  facebook: null,
  ...over,
})

const stub = (person: PersonProfile, over: Partial<PersonApi> = {}): PersonApi => ({
  getAccountProfile: () => Promise.resolve({ person }),
  ...over,
})

const show = (api: PersonApi, accountId = 'a-2', viewer: Viewer = ANNA) =>
  render(
    <ViewerProvider viewer={viewer}>
      <Person api={api} accountId={accountId} />
    </ViewerProvider>,
  )

describe('what a way of being reached is called', () => {
  it('is the network for every kind but one', () => {
    expect(nameOf({ kind: 'messenger', label: '' })).toBe('Messenger')
    expect(nameOf({ kind: 'discord', label: 'ignored' })).toBe('Discord')
  })

  it('is what somebody called their own link', () => {
    expect(nameOf({ kind: 'link', label: 'my band' })).toBe('my band')
  })
})

describe('somebody’s page', () => {
  it('draws their name and their face', async () => {
    show(stub(aPerson()))

    expect(await screen.findByRole('heading', { level: 1, name: /Wren Aldertide/ })).toBeTruthy()
  })

  it('links a way of being reached that has somewhere to go', async () => {
    show(stub(aPerson({ connections: [aWay({ id: 'c-1', kind: 'messenger', value: 'wren' })] })))

    const link = await screen.findByRole('link', { name: /Messenger/ })

    expect(link.getAttribute('href')).toBe('https://m.me/wren')
    expect(link.textContent).toBe('wren')
  })

  it('offers a copy instead where the network has no page to point at', async () => {
    // Discord: a username is a string you paste into Discord's own search, so an anchor
    // would go nowhere. This is why the vocabulary lets a kind answer with no address.
    show(stub(aPerson({ connections: [aWay({ id: 'c-1', kind: 'discord', value: 'wren' })] })))

    expect(await screen.findByText('wren')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Discord/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Copy Wren Aldertide’s Discord/ })).toBeTruthy()
  })

  it('names a link with the text it shows, so voice control can address it', async () => {
    // WCAG 2.5.3: an accessible name that drops the visible text cannot be spoken. The
    // name still says whose it is, because a page of "wren" links needs telling apart.
    show(stub(aPerson({ connections: [aWay({ id: 'c-1', kind: 'messenger', value: 'wren' })] })))

    const link = await screen.findByRole('link', { name: /Messenger/ })

    expect(link.getAttribute('aria-label')).toBe('wren, Wren Aldertide’s Messenger')
  })

  it('says "this person" rather than "them" where a name would go possessive', async () => {
    // `them` reads well in prose and not at all in "Copy them’s Discord".
    show(stub(aPerson({ name: null, connections: [aWay({ id: 'c-1', kind: 'discord', value: 'wren' })] })))

    expect(await screen.findByRole('button', { name: 'Copy this person’s Discord' })).toBeTruthy()
  })

  it('writes an email as a mailto, which is what the list is for', async () => {
    // Not `account.email`: this is the address they typed and chose to publish (#159).
    show(stub(aPerson({ connections: [aWay({ id: 'c-1', kind: 'email', value: 'wren@example.org' })] })))

    expect((await screen.findByRole('link', { name: /Email/ })).getAttribute('href')).toBe(
      'mailto:wren@example.org',
    )
  })

  it('keeps the order the server sent, which is the order they chose', async () => {
    show(
      stub(
        aPerson({
          connections: [
            aWay({ id: 'c-1', kind: 'discord', value: 'wren' }),
            aWay({ id: 'c-2', kind: 'email', value: 'wren@example.org', order: 1 }),
          ],
        }),
      ),
    )

    await waitFor(() => expect(screen.getByText('wren')).toBeTruthy())
    const shown = [...document.querySelectorAll('.way-name')].map((node) => node.textContent)

    expect(shown).toEqual(['Discord', 'Email'])
  })

  it('is still a page for somebody who has filled in nothing', async () => {
    show(stub(aPerson({ name: null })))

    expect(await screen.findByText(/Nothing said yet about how to reach them/)).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: /Someone without a name yet/ })).toBeTruthy()
  })

  it('says it is yours, and where to change it', async () => {
    show(stub(aPerson({ account_id: 'a-1' })), 'a-1')

    expect(await screen.findByText(/your own page/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Your details' }).getAttribute('href')).toBe('/profile')
  })

  it('does not offer that to somebody looking at another person', async () => {
    show(stub(aPerson()))

    await screen.findByRole('heading', { level: 1, name: /Wren Aldertide/ })
    expect(screen.queryByText(/your own page/)).toBeNull()
  })

  it('draws their Facebook page beside the name, not among the ways to reach them', async () => {
    // It is not a way of being reached — Messenger is that, and it is a row like any other.
    show(stub(aPerson({ facebook: 'https://facebook.com/wren' })))

    const link = await screen.findByRole('link', { name: /on Facebook/ })

    expect(link.getAttribute('href')).toBe('https://facebook.com/wren')
    expect(link.textContent).toContain('Wren Aldertide')
  })

  it('draws none for somebody with no Facebook handle', async () => {
    show(stub(aPerson()))

    await screen.findByRole('heading', { level: 1, name: /Wren Aldertide/ })
    expect(screen.queryByRole('link', { name: /on Facebook/ })).toBeNull()
  })

  it('shows the free-text contact last, where there is one', async () => {
    show(stub(aPerson({ contact: 'ask Anna, we live together' })))

    expect(await screen.findByText(/ask Anna, we live together/)).toBeTruthy()
  })

  it('passes the server’s own refusal through, which says what happened', async () => {
    // `errorMessage` prefers an `ApiError`'s message because the client already mapped the
    // status into something a member can read; the fallback is for what never got there.
    show(
      stub(aPerson(), {
        getAccountProfile: () => Promise.reject(apiError(404, 'not_found', 'That is not here.')),
      }),
    )

    expect((await screen.findByRole('alert')).textContent).toContain('not here')
  })

  it('falls back to its own sentence for a failure that never reached the client', async () => {
    show(stub(aPerson(), { getAccountProfile: () => Promise.reject(new Error('boom')) }))

    expect((await screen.findByRole('alert')).textContent).toContain('account may be gone')
  })
})
