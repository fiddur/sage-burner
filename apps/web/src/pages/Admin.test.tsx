import type { AdminAccountsResponse } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { AdminApi } from './Admin.tsx'

import { apiError } from '../api/client.ts'
import { ViewerProvider } from '../viewer.tsx'
import { Admin } from './Admin.tsx'

afterEach(cleanup)

const ADMIN: Viewer = { status: 'signed-in', account: { id: 'a-1', roles: ['admin'] } }
const MEMBER: Viewer = { status: 'signed-in', account: { id: 'a-2', roles: ['member'] } }

const renderAdmin = (
  getAdminAccounts: AdminApi['getAdminAccounts'],
  viewer: Viewer = ADMIN,
  setAccountRoles: AdminApi['setAccountRoles'] = () =>
    Promise.reject(new Error('setAccountRoles is not stubbed here')),
) =>
  render(
    <ViewerProvider viewer={viewer}>
      <Admin api={{ getAdminAccounts, setAccountRoles }} />
    </ViewerProvider>,
  )

const roster = (accounts: AdminAccountsResponse['accounts']) => () => Promise.resolve({ accounts })

const never = () => Promise.reject(new Error('should not have been called'))

describe('Admin', () => {
  it('lists the accounts it was given', async () => {
    renderAdmin(
      roster([
        { id: 'a-1', email: 'ada@example.org', roles: ['admin'], created_at: '2026-01-01T00:00:00.000Z' },
        { id: 'a-2', email: 'grace@example.org', roles: ['member'], created_at: '2026-01-02T00:00:00.000Z' },
      ]),
    )

    expect(await screen.findByText('ada@example.org')).toBeTruthy()
    expect(screen.getByText('grace@example.org')).toBeTruthy()
  })

  it('shows which roles an account holds', async () => {
    renderAdmin(
      roster([
        { id: 'a-1', email: 'ada@example.org', roles: ['admin'], created_at: '2026-01-01T00:00:00.000Z' },
      ]),
    )

    expect(await screen.findByRole('checkbox', { name: 'admin — ada@example.org' })).toHaveProperty(
      'checked',
      true,
    )
    expect(screen.getByRole('checkbox', { name: 'member — ada@example.org' })).toHaveProperty(
      'checked',
      false,
    )
  })

  it('grants a role, sending the whole set rather than a delta', async () => {
    // An organiser holding `admin` alone cannot reach their own profile until this
    // adds `member`. `admin:create` grants both, so that is an account someone was
    // given `admin` on, not the one the installation starts with.
    const setAccountRoles = vi.fn<AdminApi['setAccountRoles']>(() =>
      Promise.resolve({
        account: {
          id: 'a-1',
          email: 'ada@example.org',
          roles: ['admin', 'member'],
          created_at: '2026-01-01T00:00:00.000Z',
        },
      }),
    )
    renderAdmin(
      roster([
        { id: 'a-1', email: 'ada@example.org', roles: ['admin'], created_at: '2026-01-01T00:00:00.000Z' },
      ]),
      ADMIN,
      setAccountRoles,
    )

    fireEvent.click(await screen.findByRole('checkbox', { name: 'member — ada@example.org' }))

    await waitFor(() => expect(setAccountRoles).toHaveBeenCalledWith('a-1', { roles: ['admin', 'member'] }))
    expect(screen.getByRole('checkbox', { name: 'member — ada@example.org' })).toHaveProperty('checked', true)
  })

  it('takes one away without disturbing the other', async () => {
    const setAccountRoles = vi.fn<AdminApi['setAccountRoles']>(() =>
      Promise.resolve({
        account: {
          id: 'a-1',
          email: 'ada@example.org',
          roles: ['member'],
          created_at: '2026-01-01T00:00:00.000Z',
        },
      }),
    )
    renderAdmin(
      roster([
        {
          id: 'a-1',
          email: 'ada@example.org',
          roles: ['admin', 'member'],
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ]),
      ADMIN,
      setAccountRoles,
    )

    fireEvent.click(await screen.findByRole('checkbox', { name: 'admin — ada@example.org' }))

    await waitFor(() => expect(setAccountRoles).toHaveBeenCalledWith('a-1', { roles: ['member'] }))
  })

  it('explains a refused last-admin change rather than saying try again', async () => {
    // A 409 means they are the only one left, and retrying cannot change that.
    renderAdmin(
      roster([
        { id: 'a-1', email: 'ada@example.org', roles: ['admin'], created_at: '2026-01-01T00:00:00.000Z' },
      ]),
      ADMIN,
      () => Promise.reject(apiError(409, 'conflict', 'nope')),
    )

    fireEvent.click(await screen.findByRole('checkbox', { name: 'admin — ada@example.org' }))

    expect((await screen.findByRole('alert')).textContent).toContain('has to keep admin')
  })

  it('offers a member what they can set up, and asks the API nothing', async () => {
    // The accounts table is admin-only, so a member gets the two lists they may
    // curate rather than all or nothing. Asking anyway would render an error where
    // an explanation belongs.
    const getAdminAccounts = vi.fn(never)
    renderAdmin(getAdminAccounts, MEMBER)

    expect(await screen.findByRole('link', { name: 'Places' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Lodging and helping' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Invites' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Who is coming' })).toBeNull()
    expect(getAdminAccounts).not.toHaveBeenCalled()
  })

  it('offers an account with no roles nothing at all', async () => {
    const getAdminAccounts = vi.fn(never)
    renderAdmin(getAdminAccounts, { status: 'signed-in', account: { id: 'a-9', roles: [] } })

    expect(await screen.findByText(/for members/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Places' })).toBeNull()
    expect(getAdminAccounts).not.toHaveBeenCalled()
  })

  it('points a signed-out visitor at the login form', async () => {
    // Rather than "ask an existing organiser", which sends someone to a person
    // when the thing they need is the form.
    const getAdminAccounts = vi.fn(never)
    renderAdmin(getAdminAccounts, { status: 'signed-out' })

    expect(screen.getByRole('link', { name: 'Log in' }).getAttribute('href')).toBe('/login')
    expect(getAdminAccounts).not.toHaveBeenCalled()
  })

  it('waits rather than refusing while the viewer is still loading', async () => {
    // Rendering "this area is for organisers" during the first `getMe` would
    // tell an actual organiser they are not one, for as long as the round trip
    // takes.
    const getAdminAccounts = vi.fn(never)
    renderAdmin(getAdminAccounts, { status: 'loading' })

    expect(screen.getByText('One moment…')).toBeTruthy()
    expect(screen.queryByText(/admin page/)).toBeNull()
    expect(getAdminAccounts).not.toHaveBeenCalled()
  })

  it('shows the failure rather than an empty table', async () => {
    renderAdmin(() => Promise.reject(apiError(403, 'forbidden', 'You do not have access to that.')))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('You do not have access to that.')
    })
  })
})
