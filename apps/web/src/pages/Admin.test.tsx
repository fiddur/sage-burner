import type { AdminAccountsResponse } from '@sage-burner/shared'

import { cleanup, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'

import { apiError } from '../api/client.ts'
import { ViewerProvider } from '../viewer.tsx'
import { Admin } from './Admin.tsx'

afterEach(cleanup)

const ADMIN: Viewer = { status: 'signed-in', account: { id: 'a-1', roles: ['admin'] } }
const MEMBER: Viewer = { status: 'signed-in', account: { id: 'a-2', roles: ['member'] } }

const renderAdmin = (getAdminAccounts: () => Promise<AdminAccountsResponse>, viewer: Viewer = ADMIN) =>
  render(
    <ViewerProvider viewer={viewer}>
      <Admin api={{ getAdminAccounts }} />
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

  it('says so rather than showing an empty cell for an account with no roles', async () => {
    renderAdmin(
      roster([{ id: 'a-3', email: 'new@example.org', roles: [], created_at: '2026-01-03T00:00:00.000Z' }]),
    )

    expect(await screen.findByText('none yet')).toBeTruthy()
  })

  it('does not fetch for someone without the role', async () => {
    // The server would refuse anyway; asking would just render an error where
    // an explanation belongs.
    const getAdminAccounts = vi.fn(never)
    renderAdmin(getAdminAccounts, MEMBER)

    expect(await screen.findByText(/for organisers/)).toBeTruthy()
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
    expect(screen.queryByText(/for organisers/)).toBeNull()
    expect(getAdminAccounts).not.toHaveBeenCalled()
  })

  it('shows the failure rather than an empty table', async () => {
    renderAdmin(() => Promise.reject(apiError(403, 'forbidden', 'You do not have access to that.')))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('You do not have access to that.')
    })
  })
})
