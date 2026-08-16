import type { AdminInvite } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { InvitesApi } from './AdminInvites.tsx'

import { apiError } from '../api/client.ts'
import { todayForInput } from '../datetime.ts'
import { ViewerProvider } from '../viewer.tsx'
import { AdminInvites } from './AdminInvites.tsx'

afterEach(cleanup)

const anInvite = (over: Partial<AdminInvite> = {}): AdminInvite => ({
  id: 'inv-1',
  kind: 'single',
  application_id: null,
  applicant_name: null,
  label: null,
  expires_at: '2026-08-01T00:00:00.000Z',
  used_at: null,
  revoked_at: null,
  max_uses: null,
  redemptions: [],
  status: 'outstanding',
  ...over,
})

const stub = (over: Partial<InvitesApi> = {}): InvitesApi => ({
  getInvites: () => Promise.resolve({ invites: [] }),
  createInvite: () => Promise.reject(new Error('createInvite is not stubbed here')),
  createGroupInvite: () => Promise.reject(new Error('createGroupInvite is not stubbed here')),
  revokeInvite: () => Promise.reject(new Error('revokeInvite is not stubbed here')),
  ...over,
})

const renderPage = (api: InvitesApi, roles: ('admin' | 'member')[] = ['admin']) =>
  render(
    <ViewerProvider viewer={{ status: 'signed-in', account: { id: 'a-1', name: null, avatar: null, roles } }}>
      <AdminInvites api={api} />
    </ViewerProvider>,
  )

describe('AdminInvites', () => {
  it('shows the link once an invite is created', async () => {
    const createInvite = vi.fn(() =>
      Promise.resolve({
        invite: { token: 'a-secret-token', expires_at: '2026-08-01T00:00:00.000Z' },
        delivery: null,
      }),
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

  it('closes at the end of the day named, so the date given back is the date picked', async () => {
    // `vite.config.ts` pins TZ=Europe/Stockholm: under UTC both the old midnight and this
    // land on the same date, and the assertion would pass against either.
    //
    // The date is a year out rather than written down: the form refuses one already gone, so a
    // fixture with a date in it would start failing on that date rather than when something broke.
    const closes = todayForInput(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000))
    const createGroupInvite = vi.fn<InvitesApi['createGroupInvite']>(() =>
      Promise.resolve({
        invite: { token: 'a-secret-token', expires_at: `${closes}T21:59:00.000Z` },
        delivery: null,
      }),
    )
    renderPage(stub({ createGroupInvite }))

    fireEvent.input(await screen.findByLabelText('Which group'), {
      target: { value: 'The Facebook group' },
    })
    fireEvent.input(screen.getByLabelText('Closes on'), { target: { value: closes } })
    fireEvent.click(screen.getByRole('button', { name: 'Create a group link' }))

    await waitFor(() => expect(createGroupInvite).toHaveBeenCalled())
    const sent = createGroupInvite.mock.calls[0]?.[0]
    expect(sent?.expires_at.slice(0, 10)).toBe(closes)
    expect(Date.parse(sent?.expires_at ?? '')).toBeGreaterThan(Date.parse(`${closes}T12:00:00.000Z`))
  })

  it('refuses a closing date already gone, and says which field is wrong (#529)', async () => {
    const createGroupInvite = vi.fn<InvitesApi['createGroupInvite']>(() =>
      Promise.reject(new Error('should not be reached')),
    )
    renderPage(stub({ createGroupInvite }))

    fireEvent.input(await screen.findByLabelText('Which group'), { target: { value: 'A door already shut' } })
    fireEvent.input(screen.getByLabelText('Closes on'), { target: { value: '2020-01-01' } })

    expect(screen.getByText(/That date has gone/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create a group link' })).toHaveProperty('disabled', true)
    expect(createGroupInvite).not.toHaveBeenCalled()
  })

  it('offers the browser no date to pick that the server would refuse', async () => {
    renderPage(stub())

    expect((await screen.findByLabelText('Closes on')).getAttribute('min')).toBe(todayForInput())
  })

  const mintGroupLink = async () => {
    fireEvent.input(await screen.findByLabelText('Which group'), { target: { value: 'The Facebook group' } })
    fireEvent.input(screen.getByLabelText('Closes on'), {
      target: { value: todayForInput(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)) },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create a group link' }))
  }

  it('says which field a refusal was about, rather than "Request failed (400)"', async () => {
    renderPage(
      stub({
        createGroupInvite: () => Promise.reject(apiError(400, 'expired', 'Request failed (400).')),
      }),
    )

    await mintGroupLink()

    const said = await screen.findByRole('alert')
    expect(said.textContent).toContain('closing date has gone')
    expect(said.textContent).not.toContain('Request failed')
  })

  it('does not blame the closing date for a refusal that was about something else', async () => {
    renderPage(
      stub({
        createGroupInvite: () => Promise.reject(apiError(400, 'bad_request', 'Request failed (400).')),
      }),
    )

    await mintGroupLink()

    expect((await screen.findByRole('alert')).textContent).not.toContain('closing date has gone')
  })

  it('names a group link by its label and counts who has come in on it', async () => {
    renderPage(
      stub({
        getInvites: () =>
          Promise.resolve({
            invites: [
              anInvite({
                id: 'g',
                kind: 'group',
                label: 'The Facebook group',
                max_uses: 20,
                redemptions: [
                  { account_id: 'a-1', name: 'Ada', redeemed_at: '2026-08-01T00:00:00.000Z' },
                  { account_id: 'a-2', name: 'Bo', redeemed_at: '2026-08-02T00:00:00.000Z' },
                ],
              }),
            ],
          }),
      }),
    )

    expect(await screen.findByText('The Facebook group')).toBeTruthy()
    expect(screen.getByText('2 of 20')).toBeTruthy()
    expect(screen.getByText(/Ada, Bo/)).toBeTruthy()
  })

  it('counts an uncapped group link without inventing a ceiling for it', async () => {
    renderPage(
      stub({
        getInvites: () =>
          Promise.resolve({
            invites: [
              anInvite({
                id: 'g',
                kind: 'group',
                label: 'The Discord',
                max_uses: null,
                redemptions: [{ account_id: 'a-1', name: null, redeemed_at: '2026-08-01T00:00:00.000Z' }],
              }),
            ],
          }),
      }),
    )

    expect(await screen.findByText('1 so far')).toBeTruthy()
    expect(screen.getByText(/Someone/)).toBeTruthy()
  })

  it('offers no Revoke on a link already closed', async () => {
    renderPage(
      stub({
        getInvites: () =>
          Promise.resolve({
            invites: [anInvite({ id: 'g', kind: 'group', label: 'Closed', status: 'revoked' })],
          }),
      }),
    )

    await screen.findByText('Closed')
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull()
  })

  it('offers Revoke for exactly the invites the route accepts', async () => {
    // Which is every unredeemed direct one, expired included — an expired link
    // is still a row an admin wants out of the list, and the route deletes
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
    // The link is shown once and cannot be shown again, so a stale "Copied"
    // is how an admin pastes the first token twice and loses the second.
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const createInvite = vi
      .fn()
      .mockResolvedValueOnce({
        invite: { token: 'first', expires_at: '2026-08-01T00:00:00.000Z' },
        delivery: null,
      })
      .mockResolvedValueOnce({
        invite: { token: 'second', expires_at: '2026-08-01T00:00:00.000Z' },
        delivery: null,
      })
    renderPage(stub({ createInvite }))

    ;(await screen.findByRole('button', { name: 'Create an invite' })).click()
    ;(await screen.findByRole('button', { name: 'Copy link' })).click()
    await screen.findByRole('button', { name: 'Copied' })
    // The button is disabled until the re-read the mint started has landed (#176), and
    // a click on a disabled button is not a click.
    const again = screen.getByRole('button', { name: 'Create an invite' })
    await waitFor(() => expect(again.hasAttribute('disabled')).toBe(false))
    again.click()

    expect(await screen.findByText(/second/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()
  })

  it('revokes and reloads', async () => {
    const revokeInvite = vi.fn(() => Promise.resolve(undefined))
    const getInvites = vi
      .fn()
      .mockResolvedValueOnce({ invites: [anInvite()] })
      .mockResolvedValueOnce({ invites: [] })
    renderPage(stub({ getInvites, revokeInvite }))

    ;(await screen.findByRole('button', { name: 'Revoke' })).click()
    ;(await screen.findByRole('button', { name: /^Really /u })).click()

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
    ;(await screen.findByRole('button', { name: /^Really /u })).click()

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

    expect(screen.getByText(/for admins/)).toBeTruthy()
    expect(getInvites).not.toHaveBeenCalled()
  })
})
