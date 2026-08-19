import type { AdminAccountsResponse } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { AdminApi } from './Admin.tsx'

import { apiError } from '../api/client.ts'
import { ViewerProvider } from '../viewer.tsx'
import { Admin } from './Admin.tsx'

afterEach(cleanup)

const ADMIN: Viewer = {
  status: 'signed-in',
  account: { id: 'a-1', name: null, avatar: null, roles: ['admin'] },
}
const MEMBER: Viewer = {
  status: 'signed-in',
  account: { id: 'a-2', name: null, avatar: null, roles: ['member'] },
}

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

const livingRoster = (accounts: AdminAccountsResponse['accounts']) => {
  let current = accounts
  return {
    getAdminAccounts: () => Promise.resolve({ accounts: current }),
    apply: (account: AdminAccountsResponse['accounts'][number]) => {
      current = current.map((row) => (row.id === account.id ? account : row))
    },
  }
}

const never = () => Promise.reject(new Error('should not have been called'))

describe('Admin', () => {
  it('lists the accounts it was given', async () => {
    renderAdmin(
      roster([
        {
          id: 'a-1',
          email: 'ada@example.org',
          name: null,
          roles: ['admin'],
          created_at: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'a-2',
          email: 'grace@example.org',
          name: null,
          roles: ['member'],
          created_at: '2026-01-02T00:00:00.000Z',
        },
      ]),
    )

    expect(await screen.findByText('ada@example.org')).toBeTruthy()
    expect(screen.getByText('grace@example.org')).toBeTruthy()
  })

  it('names each account, the name opening its own page, and says when there is none yet', async () => {
    renderAdmin(
      roster([
        {
          id: 'a-1',
          email: 'ada@example.org',
          name: 'Ada',
          roles: ['admin'],
          created_at: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'a-2',
          email: 'grace@example.org',
          name: null,
          roles: [],
          created_at: '2026-01-02T00:00:00.000Z',
        },
      ]),
    )

    expect((await screen.findByRole('link', { name: 'Ada' })).getAttribute('href')).toBe(
      '/admin/accounts/a-1',
    )
    expect(screen.getByRole('link', { name: 'Name not filled in yet' }).getAttribute('href')).toBe(
      '/admin/accounts/a-2',
    )
  })

  it('shows which roles an account holds', async () => {
    renderAdmin(
      roster([
        {
          id: 'a-1',
          email: 'ada@example.org',
          name: null,
          roles: ['admin'],
          created_at: '2026-01-01T00:00:00.000Z',
        },
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
    const accounts = livingRoster([
      {
        id: 'a-1',
        email: 'ada@example.org',
        name: null,
        roles: ['admin'],
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ])
    const setAccountRoles = vi.fn<AdminApi['setAccountRoles']>(() => {
      const account = {
        id: 'a-1',
        email: 'ada@example.org',
        name: null,
        roles: ['admin', 'member'] as const,
        created_at: '2026-01-01T00:00:00.000Z',
      }
      accounts.apply({ ...account, roles: [...account.roles] })
      return Promise.resolve({ account: { ...account, roles: [...account.roles] } })
    })
    renderAdmin(accounts.getAdminAccounts, ADMIN, setAccountRoles)

    fireEvent.click(await screen.findByRole('checkbox', { name: 'member — ada@example.org' }))

    await waitFor(() => expect(setAccountRoles).toHaveBeenCalledWith('a-1', { roles: ['admin', 'member'] }))
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'member — ada@example.org' })).toHaveProperty(
        'checked',
        true,
      ),
    )
  })

  it('takes one away without disturbing the other', async () => {
    const accounts = livingRoster([
      {
        id: 'a-1',
        email: 'ada@example.org',
        name: null,
        roles: ['admin', 'member'],
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ])
    const setAccountRoles = vi.fn<AdminApi['setAccountRoles']>(() => {
      const account = {
        id: 'a-1',
        email: 'ada@example.org',
        name: null,
        roles: ['member' as const],
        created_at: '2026-01-01T00:00:00.000Z',
      }
      accounts.apply(account)
      return Promise.resolve({ account })
    })
    renderAdmin(accounts.getAdminAccounts, ADMIN, setAccountRoles)

    fireEvent.click(await screen.findByRole('checkbox', { name: 'admin — ada@example.org' }))

    await waitFor(() => expect(setAccountRoles).toHaveBeenCalledWith('a-1', { roles: ['member'] }))
  })

  it('explains a refused last-admin change rather than saying try again', async () => {
    renderAdmin(
      roster([
        {
          id: 'a-1',
          email: 'ada@example.org',
          name: null,
          roles: ['admin'],
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ]),
      ADMIN,
      () => Promise.reject(apiError(409, 'conflict', 'nope')),
    )

    fireEvent.click(await screen.findByRole('checkbox', { name: 'admin — ada@example.org' }))

    expect((await screen.findByRole('alert')).textContent).toContain('has to keep admin')
  })

  it('refuses a member, whose two lists are reached from their own pages now', async () => {
    const getAdminAccounts = vi.fn(never)
    renderAdmin(getAdminAccounts, MEMBER)

    expect(await screen.findByText(/for admins/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Places' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Lodging and helping' })).toBeNull()
    expect(getAdminAccounts).not.toHaveBeenCalled()
  })

  it('offers an account with no roles nothing at all', async () => {
    const getAdminAccounts = vi.fn(never)
    renderAdmin(getAdminAccounts, {
      status: 'signed-in',
      account: { id: 'a-9', name: null, avatar: null, roles: [] },
    })

    expect(await screen.findByText(/for admins/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Places' })).toBeNull()
    expect(getAdminAccounts).not.toHaveBeenCalled()
  })

  it('points a signed-out visitor at the login form', async () => {
    const getAdminAccounts = vi.fn(never)
    renderAdmin(getAdminAccounts, { status: 'signed-out' })

    expect(screen.getByRole('link', { name: 'Log in' }).getAttribute('href')).toBe('/login')
    expect(getAdminAccounts).not.toHaveBeenCalled()
  })

  it('waits rather than refusing while the viewer is still loading', async () => {
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

describe('the window between a write and the re-read', () => {
  it('keeps the boxes disabled until the re-read has landed (#176)', async () => {
    let answer: (value: AdminAccountsResponse) => void = () => undefined
    const getAdminAccounts = vi.fn(() => new Promise<AdminAccountsResponse>((resolve) => (answer = resolve)))
    const ada = {
      id: 'a-1',
      email: 'ada@example.org',
      name: null,
      created_at: '2026-01-01T00:00:00.000Z',
    }
    const setAccountRoles = vi.fn<AdminApi['setAccountRoles']>(() =>
      Promise.resolve({ account: { ...ada, roles: ['member'] } }),
    )
    renderAdmin(getAdminAccounts, ADMIN, setAccountRoles)

    answer({ accounts: [{ ...ada, roles: [] }] })
    const box = await screen.findByRole('checkbox', { name: 'member — ada@example.org' })

    fireEvent.click(box)

    await waitFor(() => expect(setAccountRoles).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(getAdminAccounts).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('checkbox', { name: 'admin — ada@example.org' })).toHaveProperty('disabled', true)

    answer({ accounts: [{ ...ada, roles: ['member'] }] })

    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'admin — ada@example.org' })).toHaveProperty(
        'disabled',
        false,
      ),
    )
  })
})
