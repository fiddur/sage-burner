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
  answers: [{ question_id: 'q-1', label: 'Why do you want to come?', type: 'text', value: 'the fire' }],
  status: 'pending',
  applicant_name: 'Fredrik',
  applicant_contact: 'fredrik@example.org',
  submitted_at: '2026-07-02T10:00:00Z',
  decided_at: null,
  ...over,
})

const stub = (over: Partial<ApplicationsApi> = {}): ApplicationsApi => ({
  getApplications: () => Promise.resolve({ applications: [anApplication()] }),
  approveApplication: () => Promise.reject(new Error('approveApplication is not stubbed here')),
  rejectApplication: () => Promise.reject(new Error('rejectApplication is not stubbed here')),
  ...over,
})

const renderPage = (api: ApplicationsApi, roles: ('admin' | 'member')[] = ['admin']) =>
  render(
    <ViewerProvider viewer={{ status: 'signed-in', account: { id: 'a-1', roles } }}>
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
      }),
    )
    renderPage(stub({ approveApplication }))

    ;(await screen.findByRole('button', { name: 'Approve' })).click()

    expect((await screen.findByRole('status')).textContent).toContain('shown once')
    expect(screen.getByText(/a-very-secret-token/)).toBeTruthy()
    expect(approveApplication).toHaveBeenCalledWith('app-1')
  })

  it('does not say "Copied" when the copy failed', async () => {
    // The token is shown once and there is no re-issue path (#91), so a false
    // "Copied" is how an organiser loses an applicant's invite.
    const writeText = vi.fn(() => Promise.reject(new Error('denied')))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    renderPage(
      stub({
        approveApplication: () =>
          Promise.resolve({
            application: anApplication({ status: 'approved', decided_at: '2026-07-03T00:00:00Z' }),
            invite: { token: 't', expires_at: '2026-08-02T00:00:00Z' },
          }),
      }),
    )

    ;(await screen.findByRole('button', { name: 'Approve' })).click()
    ;(await screen.findByRole('button', { name: 'Copy link' })).click()

    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()
    vi.unstubAllGlobals()
  })

  it('survives a browser with no clipboard at all', async () => {
    // `navigator.clipboard` is undefined on a non-secure origin, where the old
    // code threw before the handler could do anything.
    vi.stubGlobal('navigator', {})
    renderPage(
      stub({
        approveApplication: () =>
          Promise.resolve({
            application: anApplication({ status: 'approved', decided_at: '2026-07-03T00:00:00Z' }),
            invite: { token: 't', expires_at: '2026-08-02T00:00:00Z' },
          }),
      }),
    )

    ;(await screen.findByRole('button', { name: 'Approve' })).click()
    ;(await screen.findByRole('button', { name: 'Copy link' })).click()

    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()
    vi.unstubAllGlobals()
  })

  it('stops offering a decision once one is made', async () => {
    renderPage(
      stub({
        approveApplication: () =>
          Promise.resolve({
            application: anApplication({ status: 'approved', decided_at: '2026-07-03T00:00:00Z' }),
            invite: { token: 't', expires_at: '2026-08-02T00:00:00Z' },
          }),
      }),
    )

    ;(await screen.findByRole('button', { name: 'Approve' })).click()

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull())
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull()
  })

  it('rejects without showing an invite', async () => {
    const rejectApplication = vi.fn(() =>
      Promise.resolve({
        application: anApplication({ status: 'rejected', decided_at: '2026-07-03T00:00:00Z' }),
        invite: null,
      }),
    )
    renderPage(stub({ rejectApplication }))

    ;(await screen.findByRole('button', { name: 'Reject' })).click()

    await waitFor(() => expect(rejectApplication).toHaveBeenCalledWith('app-1'))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('tells the organiser to reload when someone else decided first', async () => {
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

    expect(screen.getByText(/for organisers/)).toBeTruthy()
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
