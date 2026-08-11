import type { Application } from '@sage-burner/shared'

import { cleanup, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ApplicationsApi } from './AdminApplications.tsx'

import { apiError } from '../api/client.ts'
import { ViewerProvider } from '../viewer.tsx'
import { AdminApplications } from './AdminApplications.tsx'

afterEach(cleanup)

const anApplication = (over: Partial<Application> = {}): Application => ({
  id: 'app-1',
  account_id: null,
  answers: [{ question_id: 'q-1', label: 'Why do you want to come?', type: 'text', value: 'the fire' }],
  status: 'pending',
  applicant_name: 'Fredrik',
  applicant_email: 'fredrik@example.org',
  submitted_at: '2026-07-02T10:00:00Z',
  decided_at: null,
  ...over,
})

const stub = (over: Partial<ApplicationsApi> = {}): ApplicationsApi => ({
  getApplications: () => Promise.resolve({ applications: [anApplication()] }),
  approveApplication: () => Promise.reject(new Error('approveApplication is not stubbed here')),
  rejectApplication: () => Promise.reject(new Error('rejectApplication is not stubbed here')),
  reissueInvite: () => Promise.reject(new Error('reissueInvite is not stubbed here')),
  ...over,
})

const renderPage = (api: ApplicationsApi, roles: ('admin' | 'member')[] = ['admin']) =>
  render(
    <ViewerProvider viewer={{ status: 'signed-in', account: { id: 'a-1', name: null, avatar: null, roles } }}>
      <AdminApplications api={api} />
    </ViewerProvider>,
  )

describe('AdminApplications', () => {
  it('shows an application with its answers', async () => {
    renderPage(stub())

    expect(await screen.findByRole('heading', { name: 'Fredrik' })).toBeTruthy()
    expect(screen.getByText('Why do you want to come?')).toBeTruthy()
    expect(screen.getByText('the fire')).toBeTruthy()
  })

  it('shows the invite link once approved', async () => {
    const approveApplication = vi.fn(() =>
      Promise.resolve({
        application: anApplication({ status: 'approved', decided_at: '2026-07-03T00:00:00Z' }),
        invite: { token: 'a-very-secret-token', expires_at: '2026-08-02T00:00:00Z' },
        delivery: null,
      }),
    )
    renderPage(stub({ approveApplication }))

    ;(await screen.findByRole('button', { name: 'Approve' })).click()

    expect((await screen.findByRole('status')).textContent).toContain('shown once')
    expect(screen.getByText(/a-very-secret-token/)).toBeTruthy()
    expect(approveApplication).toHaveBeenCalledWith('app-1')
  })

  it('says the invite was emailed, and where to', async () => {
    // The bug this fixed: the link was already in the applicant's inbox and the page
    // said to send it, so they got it twice from two people (#327).
    const approveApplication = vi.fn(() =>
      Promise.resolve({
        application: anApplication({ status: 'approved', decided_at: '2026-07-03T00:00:00Z' }),
        invite: { token: 'a-very-secret-token', expires_at: '2026-08-02T00:00:00Z' },
        delivery: { sent: true, to: 'fredrik@example.org', reason: null },
      }),
    )
    renderPage(stub({ approveApplication }))

    ;(await screen.findByRole('button', { name: 'Approve' })).click()

    const note = await screen.findByRole('status')
    expect(note.textContent).toContain('Emailed to fredrik@example.org')
    // Still shown: a bounce is invisible to this app, and the admin may need it.
    expect(screen.getByText(/a-very-secret-token/)).toBeTruthy()
  })

  it('says why the invite was not emailed, and still asks for the link to be sent', async () => {
    // The other direction, and how a real invite went missing: every send failed with a
    // TLS record error and the page's answer was unchanged.
    renderPage(
      stub({
        approveApplication: () =>
          Promise.resolve({
            application: anApplication({ status: 'approved', decided_at: '2026-07-03T00:00:00Z' }),
            invite: { token: 'a-very-secret-token', expires_at: '2026-08-02T00:00:00Z' },
            delivery: {
              sent: false,
              to: 'fredrik@example.org',
              // A raw driver message, which is the one kind of reason that arrives
              // without a full stop of its own.
              reason: 'wrong version number',
            },
          }),
      }),
    )

    ;(await screen.findByRole('button', { name: 'Approve' })).click()

    const note = await screen.findByRole('status')
    expect(note.textContent).toContain('Not emailed.')
    expect(note.textContent).toContain('Why: wrong version number')
    expect(note.textContent).toContain('Send this link')
  })

  it('does not double the full stop on a reason that is already a sentence', async () => {
    // Every reason the server produces ends in one — `NOT_CONFIGURED` is "No mail server
    // has been set up." — and appending another read as "up.. Send this link".
    renderPage(
      stub({
        approveApplication: () =>
          Promise.resolve({
            application: anApplication({ status: 'approved', decided_at: '2026-07-03T00:00:00Z' }),
            invite: { token: 'a-very-secret-token', expires_at: '2026-08-02T00:00:00Z' },
            delivery: { sent: false, to: 'fredrik@example.org', reason: 'No mail server has been set up.' },
          }),
      }),
    )

    ;(await screen.findByRole('button', { name: 'Approve' })).click()

    const note = await screen.findByRole('status')
    expect(note.textContent).toContain('Why: No mail server has been set up.')
    expect(note.textContent).not.toContain('up..')
  })

  it('does not say "Copied" when the copy failed', async () => {
    // The token is shown once and cannot be shown again, so a false "Copied" is
    // how an admin loses this applicant's invite — recoverable only by
    // minting a direct one, which drops the tie to their application (#91).
    const writeText = vi.fn(() => Promise.reject(new Error('denied')))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    renderPage(
      stub({
        approveApplication: () =>
          Promise.resolve({
            application: anApplication({ status: 'approved', decided_at: '2026-07-03T00:00:00Z' }),
            invite: { token: 't', expires_at: '2026-08-02T00:00:00Z' },
            delivery: null,
          }),
      }),
    )

    ;(await screen.findByRole('button', { name: 'Approve' })).click()
    ;(await screen.findByRole('button', { name: 'Copy link' })).click()

    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()
  })

  it('survives a browser with no clipboard at all', async () => {
    // `navigator.clipboard` is undefined on a non-secure origin.
    vi.stubGlobal('navigator', {})
    renderPage(
      stub({
        approveApplication: () =>
          Promise.resolve({
            application: anApplication({ status: 'approved', decided_at: '2026-07-03T00:00:00Z' }),
            invite: { token: 't', expires_at: '2026-08-02T00:00:00Z' },
            delivery: null,
          }),
      }),
    )

    ;(await screen.findByRole('button', { name: 'Approve' })).click()
    ;(await screen.findByRole('button', { name: 'Copy link' })).click()

    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()
  })

  it('stops offering a decision once one is made', async () => {
    // The stub tracks the decision because the page re-reads rather than patching
    // what is on screen: the server is what knows the status afterwards, and a stub
    // that kept answering `pending` would be asserting the client-side patch this
    // page deliberately does not do.
    let decided = false
    renderPage(
      stub({
        getApplications: () =>
          Promise.resolve({
            applications: [
              anApplication(decided ? { status: 'approved', decided_at: '2026-07-03T00:00:00Z' } : {}),
            ],
          }),
        approveApplication: () => {
          decided = true
          return Promise.resolve({
            application: anApplication({ status: 'approved', decided_at: '2026-07-03T00:00:00Z' }),
            invite: { token: 't', expires_at: '2026-08-02T00:00:00Z' },
            delivery: null,
          })
        },
      }),
    )

    ;(await screen.findByRole('button', { name: 'Approve' })).click()

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull())
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull()
  })

  it('offers a new link on an approved application, and shows it once', async () => {
    const reissueInvite = vi.fn(() =>
      Promise.resolve({
        invite: { token: 'the-replacement', expires_at: '2026-09-02T00:00:00Z' },
        delivery: null,
      }),
    )
    renderPage(
      stub({
        getApplications: () =>
          Promise.resolve({
            applications: [anApplication({ status: 'approved', decided_at: '2026-07-03T00:00:00Z' })],
          }),
        reissueInvite,
      }),
    )

    ;(await screen.findByRole('button', { name: 'Send a new link' })).click()

    await waitFor(() => {
      expect(reissueInvite).toHaveBeenCalledWith('app-1')
    })
    expect(await screen.findByText(/the-replacement/)).toBeTruthy()
  })

  it('does not offer a new link on one nobody has decided', async () => {
    renderPage(stub())

    expect(await screen.findByRole('button', { name: 'Approve' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send a new link' })).toBeNull()
  })

  /** An approved application, which is the only row that offers a new link. */
  const withReissue = (reissueInvite: ApplicationsApi['reissueInvite']) =>
    renderPage(
      stub({
        getApplications: () =>
          Promise.resolve({
            applications: [anApplication({ status: 'approved', decided_at: '2026-07-03T00:00:00Z' })],
          }),
        reissueInvite,
      }),
    )

  it('says so when the invite has already been used', async () => {
    // Worth saying rather than "please try again": they are already in, and trying
    // again would fail the same way.
    withReissue(() => Promise.reject(apiError(409, 'invite_used', 'Request failed (409).')))

    ;(await screen.findByRole('button', { name: 'Send a new link' })).click()

    expect((await screen.findByRole('alert')).textContent).toContain('already in')
  })

  it('says something else when the application was never approved', async () => {
    // The same 409, told apart by the slug — see `errorCodes` (#178).
    withReissue(() => Promise.reject(apiError(409, 'not_approved', 'Request failed (409).')))

    ;(await screen.findByRole('button', { name: 'Send a new link' })).click()

    const said = (await screen.findByRole('alert')).textContent
    expect(said).toContain('has not been approved')
    expect(said).not.toContain('already in')
  })

  it('falls back to try-again for a refusal it has no words for', async () => {
    withReissue(() => Promise.reject(apiError(409, 'conflict', 'Request failed (409).')))

    ;(await screen.findByRole('button', { name: 'Send a new link' })).click()

    expect((await screen.findByRole('alert')).textContent).toContain('Please try again')
  })

  it('rejects without showing an invite', async () => {
    const rejectApplication = vi.fn(() =>
      Promise.resolve({
        application: anApplication({ status: 'rejected', decided_at: '2026-07-03T00:00:00Z' }),
        invite: null,
        delivery: null,
      }),
    )
    renderPage(stub({ rejectApplication }))

    ;(await screen.findByRole('button', { name: 'Reject' })).click()

    await waitFor(() => expect(rejectApplication).toHaveBeenCalledWith('app-1'))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('says to reload when someone else decided first', async () => {
    // A 409 means the list on screen is stale, so "try again" would send them
    // round the same loop.
    renderPage(stub({ approveApplication: () => Promise.reject(apiError(409, 'conflict', 'nope')) }))

    ;(await screen.findByRole('button', { name: 'Approve' })).click()

    expect((await screen.findByRole('alert')).textContent).toContain('already decided')
  })

  it('says a failure is worth retrying when it is not a conflict', async () => {
    renderPage(stub({ approveApplication: () => Promise.reject(new TypeError('Failed to fetch')) }))

    ;(await screen.findByRole('button', { name: 'Approve' })).click()

    expect((await screen.findByRole('alert')).textContent).toContain('try again')
  })

  it('says so when nobody has applied', async () => {
    renderPage(stub({ getApplications: () => Promise.resolve({ applications: [] }) }))

    expect(await screen.findByText(/Nobody has applied yet/)).toBeTruthy()
  })

  it('surfaces a failure to load', async () => {
    renderPage(stub({ getApplications: () => Promise.reject(new Error('nope')) }))

    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('does not fetch for someone without the role', async () => {
    // The page hiding itself is not the access control — the API refuses a
    // non-admin whatever this renders — but it should not ask either.
    const getApplications = vi.fn(() => Promise.resolve({ applications: [] }))
    renderPage(stub({ getApplications }), ['member'])

    expect(screen.getByText(/for admins/)).toBeTruthy()
    expect(getApplications).not.toHaveBeenCalled()
  })

  it('renders a tick-box answer as words rather than a raw boolean', async () => {
    renderPage(
      stub({
        getApplications: () =>
          Promise.resolve({
            applications: [
              anApplication({
                answers: [
                  { question_id: 'q-1', label: 'I agree', type: 'agreement', value: true },
                  { question_id: 'q-2', label: 'Bring food', type: 'checkbox', value: false },
                ],
              }),
            ],
          }),
      }),
    )

    expect(await screen.findByText('Yes')).toBeTruthy()
    expect(screen.getByText('No')).toBeTruthy()
  })
})
