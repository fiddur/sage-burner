import type { AdminInvite } from '@sage-burner/shared'

import { cleanup, render, screen, waitFor, within } from '@testing-library/preact'
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

  it('offers Revoke for exactly the invites the route accepts', async () => {
    // Which is every unredeemed direct one, expired included — an expired link
    // is still a row an organiser wants out of the list, and the route deletes
    // it happily. Only `used` and application-backed invites are refused.
    renderPage(
      stub({
        getInvites: () =>
          Promise.resolve({
            invites: [
              anInvite({ id: 'a', status: 'outstanding', expires_at: '2026-08-01T00:00:00.000Z' }),
              anInvite({ id: 'b', status: 'expired', expires_at: '2026-08-02T00:00:00.000Z' }),
              anInvite({ id: 'c', status: 'used', expires_at: '2026-08-03T00:00:00.000Z' }),
              anInvite({
                id: 'd',
                application_id: 'app-1',
                applicant_name: 'Fredrik',
                expires_at: '2026-08-04T00:00:00.000Z',
              }),
            ],
          }),
      }),
    )

    await screen.findByText('Application from Fredrik')

    // Per row, not a count: inverting the predicate moves the button to the other
    // two rows and a count of two stays green. Rows are addressed by their
    // expiry, which is the one column unique to each here.
    const revokeIn = (expiry: string) => {
      const row = screen.getByText(expiry).closest('tr')
      if (row === null) throw new Error(`no row expiring ${expiry}`)

      return within(row).queryByRole('button', { name: 'Revoke' })
    }

    expect(revokeIn('2026-08-01'), 'outstanding direct').not.toBeNull()
    expect(revokeIn('2026-08-02'), 'expired direct').not.toBeNull()
    expect(revokeIn('2026-08-03'), 'used').toBeNull()
    expect(revokeIn('2026-08-04'), 'application').toBeNull()
  })

  it('does not still say Copied after a second invite is minted', async () => {
    // The link is shown once and cannot be re-issued (#91), so a stale "Copied"
    // is how an organiser pastes the first token twice and loses the second.
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const createInvite = vi
      .fn()
      .mockResolvedValueOnce({ invite: { token: 'first', expires_at: '2026-08-01T00:00:00.000Z' } })
      .mockResolvedValueOnce({ invite: { token: 'second', expires_at: '2026-08-01T00:00:00.000Z' } })
    renderPage(stub({ createInvite }))

    ;(await screen.findByRole('button', { name: 'Create an invite' })).click()
    ;(await screen.findByRole('button', { name: 'Copy link' })).click()
    await screen.findByRole('button', { name: 'Copied' })
    screen.getByRole('button', { name: 'Create an invite' }).click()

    expect(await screen.findByText(/second/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()
    vi.unstubAllGlobals()
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

    expect(screen.getByText(/admin page/)).toBeTruthy()
    expect(getInvites).not.toHaveBeenCalled()
  })
})
