import type { AdminInvite } from '@sage-burner/shared'

import { cleanup, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { InvitesApi } from './AdminInvites.tsx'

import { apiError } from '../api/client.ts'
import { ViewerProvider } from '../viewer.tsx'
import { AdminInvites } from './AdminInvites.tsx'

afterEach(cleanup)

const anInvite = (over: Partial<AdminInvite> = {}): AdminInvite => ({
  id: 'inv-1',
  application_id: null,
  applicant_name: null,
  expires_at: '2026-08-01T00:00:00.000Z',
  used_at: null,
  status: 'outstanding',
  ...over,
})

const stub = (over: Partial<InvitesApi> = {}): InvitesApi => ({
  getInvites: () => Promise.resolve({ invites: [] }),
  createInvite: () => Promise.reject(new Error('createInvite is not stubbed here')),
  revokeInvite: () => Promise.reject(new Error('revokeInvite is not stubbed here')),
  ...over,
})

const renderPage = (api: InvitesApi, roles: ('admin' | 'member')[] = ['admin']) =>
  render(
    <ViewerProvider viewer={{ status: 'signed-in', account: { id: 'a-1', roles } }}>
      <AdminInvites api={api} />
    </ViewerProvider>,
  )

describe('AdminInvites', () => {
  it('shows the link once an invite is created', async () => {
    const createInvite = vi.fn(() =>
      Promise.resolve({ invite: { token: 'a-secret-token', expires_at: '2026-08-01T00:00:00.000Z' } }),
    )
    renderPage(stub({ createInvite }))

    ;(await screen.findByRole('button', { name: 'Create an invite' })).click()

    expect((await screen.findByRole('status')).textContent).toContain('shown once')
    expect(screen.getByText(/a-secret-token/)).toBeTruthy()
  })

  it('lists what is outstanding, used and expired', async () => {
    renderPage(
      stub({
        getInvites: () =>
          Promise.resolve({
            invites: [
              anInvite({ id: 'a', status: 'outstanding' }),
              anInvite({ id: 'b', status: 'used', used_at: '2026-07-03T00:00:00.000Z' }),
              anInvite({ id: 'c', status: 'expired' }),
            ],
          }),
      }),
    )

    await screen.findByText('outstanding')
    expect(screen.getByText('used')).toBeTruthy()
    expect(screen.getByText('expired')).toBeTruthy()
  })

  it('tells an application invite apart from a direct one', async () => {
    renderPage(
      stub({
        getInvites: () =>
          Promise.resolve({
            invites: [
              anInvite({ id: 'a' }),
              anInvite({ id: 'b', application_id: 'app-1', applicant_name: 'Fredrik' }),
            ],
          }),
      }),
    )

    expect(await screen.findByText('Direct invite')).toBeTruthy()
    expect(screen.getByText('Application from Fredrik')).toBeTruthy()
  })

  it('offers Revoke only for an outstanding direct invite', async () => {
    // The other three are refused server-side; offering the button would be an
    // invitation to meet a 409.
    renderPage(
      stub({
        getInvites: () =>
          Promise.resolve({
            invites: [
              anInvite({ id: 'a', status: 'outstanding' }),
              anInvite({ id: 'b', status: 'used' }),
              anInvite({ id: 'c', status: 'expired' }),
              anInvite({ id: 'd', application_id: 'app-1', applicant_name: 'Fredrik' }),
            ],
          }),
      }),
    )

    await screen.findByText('Application from Fredrik')
    expect(screen.getAllByRole('button', { name: 'Revoke' })).toHaveLength(1)
  })

  it('revokes and reloads', async () => {
    const revokeInvite = vi.fn(() => Promise.resolve(undefined))
    const getInvites = vi
      .fn()
      .mockResolvedValueOnce({ invites: [anInvite()] })
      .mockResolvedValueOnce({ invites: [] })
    renderPage(stub({ getInvites, revokeInvite }))

    ;(await screen.findByRole('button', { name: 'Revoke' })).click()

    await waitFor(() => expect(revokeInvite).toHaveBeenCalledWith('inv-1'))
    expect(await screen.findByText('No invites yet.')).toBeTruthy()
  })

  it('explains a refused revoke rather than saying try again', async () => {
    renderPage(
      stub({
        getInvites: () => Promise.resolve({ invites: [anInvite()] }),
        revokeInvite: () => Promise.reject(apiError(409, 'conflict', 'nope')),
      }),
    )

    ;(await screen.findByRole('button', { name: 'Revoke' })).click()

    expect((await screen.findByRole('alert')).textContent).toContain('cannot be revoked')
  })

  it('says so when there are none', async () => {
    renderPage(stub())

    expect(await screen.findByText('No invites yet.')).toBeTruthy()
  })

  it('surfaces a failure to load', async () => {
    renderPage(stub({ getInvites: () => Promise.reject(new Error('nope')) }))

    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('does not fetch for someone without the role', async () => {
    const getInvites = vi.fn(() => Promise.resolve({ invites: [] }))
    renderPage(stub({ getInvites }), ['member'])

    expect(screen.getByText(/for organisers/)).toBeTruthy()
    expect(getInvites).not.toHaveBeenCalled()
  })
})
