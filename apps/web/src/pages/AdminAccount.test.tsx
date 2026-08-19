import type { AdminAccountDetail } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { AdminAccountApi } from './AdminAccount.tsx'

import { apiError } from '../api/client.ts'
import { ViewerProvider } from '../viewer.tsx'
import { AdminAccount } from './AdminAccount.tsx'

afterEach(cleanup)

const ADMIN: Viewer = {
  status: 'signed-in',
  account: { id: 'a-1', name: null, avatar: null, roles: ['admin'] },
}

const wren = (over: Partial<AdminAccountDetail> = {}): AdminAccountDetail => ({
  id: 'a-9',
  email: 'wren@example.org',
  name: 'Wren',
  roles: ['member'],
  created_at: '2026-01-01T00:00:00.000Z',
  has_password: true,
  passkeys: 0,
  identities: [],
  allergies_notes: null,
  allergy_item_ids: [],
  ...over,
})

const stub = (over: Partial<AdminAccountApi> = {}): AdminAccountApi => ({
  getAdminAccount: () => Promise.resolve({ account: wren() }),
  updateAdminAccount: () => Promise.reject(new Error('updateAdminAccount is not stubbed here')),
  setAccountPassword: () => Promise.reject(new Error('setAccountPassword is not stubbed here')),
  getAllergyItems: () => Promise.resolve({ items: [{ id: 'nuts', order: 0, label: 'Nuts' }] }),
  ...over,
})

const renderPage = (api: AdminAccountApi, viewer: Viewer = ADMIN) =>
  render(
    <ViewerProvider viewer={viewer}>
      <AdminAccount api={api} accountId="a-9" />
    </ViewerProvider>,
  )

describe('AdminAccount', () => {
  it('loads the account it was pointed at and fills the form from it', async () => {
    const getAdminAccount = vi.fn(() =>
      Promise.resolve({ account: wren({ allergies_notes: 'kiwi', allergy_item_ids: ['nuts'] }) }),
    )
    renderPage(stub({ getAdminAccount }))

    expect(await screen.findByRole('heading', { name: 'Wren' })).toBeTruthy()
    expect(getAdminAccount).toHaveBeenCalledWith('a-9', expect.anything())
    expect(screen.getByLabelText('Real name')).toHaveProperty('value', 'Wren')
    expect(screen.getByLabelText('Login address')).toHaveProperty('value', 'wren@example.org')
    expect(screen.getByLabelText('Nuts')).toHaveProperty('checked', true)
    expect(screen.getByLabelText('Anything else you cannot eat')).toHaveProperty('value', 'kiwi')
  })

  it('heads an account with no name by its address, the name field starting empty', async () => {
    renderPage(stub({ getAdminAccount: () => Promise.resolve({ account: wren({ name: null, roles: [] }) }) }))

    expect(await screen.findByRole('heading', { name: 'wren@example.org' })).toBeTruthy()
    expect(screen.getByLabelText('Real name')).toHaveProperty('value', '')
    expect(screen.getByText(/No role yet/)).toBeTruthy()
  })

  it('sends the whole form, trimmed, with empty notes as null', async () => {
    const updateAdminAccount = vi.fn<AdminAccountApi['updateAdminAccount']>(() =>
      Promise.resolve({ account: wren({ name: 'Wren Real' }) }),
    )
    renderPage(stub({ updateAdminAccount }))

    fireEvent.input(await screen.findByLabelText('Real name'), { target: { value: '  Wren Real ' } })
    fireEvent.input(screen.getByLabelText('Login address'), { target: { value: 'new@example.org' } })
    fireEvent.click(screen.getByLabelText('Nuts'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateAdminAccount).toHaveBeenCalledWith('a-9', {
        name: 'Wren Real',
        email: 'new@example.org',
        allergies_notes: null,
        allergy_item_ids: ['nuts'],
      }),
    )
    expect((await screen.findByRole('status')).textContent).toBe('Saved.')
  })

  it('lets the free text be moved into a tick: untick nothing, clear the text, tick the item', async () => {
    const updateAdminAccount = vi.fn<AdminAccountApi['updateAdminAccount']>(() =>
      Promise.resolve({ account: wren({ allergy_item_ids: ['nuts'] }) }),
    )
    renderPage(
      stub({
        updateAdminAccount,
        getAdminAccount: () => Promise.resolve({ account: wren({ allergies_notes: 'nuts' }) }),
      }),
    )

    fireEvent.input(await screen.findByLabelText('Anything else you cannot eat'), { target: { value: '' } })
    fireEvent.click(screen.getByLabelText('Nuts'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateAdminAccount).toHaveBeenCalledWith(
        'a-9',
        expect.objectContaining({ allergies_notes: null, allergy_item_ids: ['nuts'] }),
      ),
    )
  })

  it('refuses to send an empty name or address', async () => {
    const updateAdminAccount = vi.fn<AdminAccountApi['updateAdminAccount']>()
    renderPage(stub({ updateAdminAccount }))

    fireEvent.input(await screen.findByLabelText('Real name'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect((await screen.findByRole('alert')).textContent).toContain('both needed')
    expect(updateAdminAccount).not.toHaveBeenCalled()
  })

  it('says when the address is already another account’s', async () => {
    renderPage(
      stub({
        updateAdminAccount: () => Promise.reject(apiError(409, 'conflict', 'conflict')),
      }),
    )

    fireEvent.input(await screen.findByLabelText('Login address'), { target: { value: 'taken@example.org' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect((await screen.findByRole('alert')).textContent).toContain('already signs in with that address')
  })

  it('says how they get in, so an admin setting a password knows whether there is one', async () => {
    renderPage(
      stub({
        getAdminAccount: () =>
          Promise.resolve({ account: wren({ has_password: false, passkeys: 2, identities: ['discord'] }) }),
      }),
    )

    expect((await screen.findByText(/Signs in with/)).textContent).toBe('Signs in with 2 passkeys, Discord.')
  })

  it('says plainly when there is no way in at all', async () => {
    renderPage(stub({ getAdminAccount: () => Promise.resolve({ account: wren({ has_password: false }) }) }))

    expect(await screen.findByText(/No way in yet/)).toBeTruthy()
  })

  it('sets a password for this account and re-reads, so the ways in update', async () => {
    const setAccountPassword = vi.fn<AdminAccountApi['setAccountPassword']>(() => Promise.resolve(undefined))
    let held = wren({ has_password: false })
    const getAdminAccount = vi.fn(() => Promise.resolve({ account: held }))
    renderPage(stub({ getAdminAccount, setAccountPassword }))

    await screen.findByText(/No way in yet/)
    held = wren({ has_password: true })
    fireEvent.input(screen.getByLabelText('New password for wren@example.org'), {
      target: { value: 'a-new-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Set it' }))

    await waitFor(() =>
      expect(setAccountPassword).toHaveBeenCalledWith('a-9', { password: 'a-new-password' }),
    )
    expect((await screen.findByText(/Signs in with/)).textContent).toBe('Signs in with a password.')
  })

  it('refuses a member', async () => {
    const getAdminAccount = vi.fn(() => Promise.reject(new Error('should not be called')))
    renderPage(stub({ getAdminAccount }), {
      status: 'signed-in',
      account: { id: 'a-2', name: null, avatar: null, roles: ['member'] },
    })

    expect(await screen.findByText(/for admins/)).toBeTruthy()
    expect(getAdminAccount).not.toHaveBeenCalled()
  })

  it('shows the failure rather than an empty form', async () => {
    renderPage(stub({ getAdminAccount: () => Promise.reject(new Error('down')) }))

    expect((await screen.findByRole('alert')).textContent).toContain('Could not load that account')
  })
})

describe('setting somebody’s password', () => {
  it('clears the field and says so, since nobody can read it back', async () => {
    renderPage(stub({ setAccountPassword: () => Promise.resolve(undefined) }))

    fireEvent.input(await screen.findByLabelText('New password for wren@example.org'), {
      target: { value: 'a-new-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Set it' }))

    expect((await screen.findByRole('status')).textContent).toContain('Tell them what it is')
    expect(screen.getByLabelText('New password for wren@example.org')).toHaveProperty('value', '')
  })

  it('will not send an empty one', async () => {
    const setAccountPassword = vi.fn<AdminAccountApi['setAccountPassword']>(() => Promise.resolve(undefined))
    renderPage(stub({ setAccountPassword }))

    await screen.findByLabelText('New password for wren@example.org')

    expect(screen.getByRole('button', { name: 'Set it' })).toHaveProperty('disabled', true)
    expect(setAccountPassword).not.toHaveBeenCalled()
  })

  it('says when it did not work, and keeps what was typed', async () => {
    renderPage(stub({ setAccountPassword: () => Promise.reject(new Error('nope')) }))

    fireEvent.input(await screen.findByLabelText('New password for wren@example.org'), {
      target: { value: 'a-new-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Set it' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Could not set that password')
    expect(screen.getByLabelText('New password for wren@example.org')).toHaveProperty(
      'value',
      'a-new-password',
    )
  })
})
