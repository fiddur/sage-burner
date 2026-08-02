import type { InviteState } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { InviteApi } from './Invite.tsx'

import { apiError } from '../api/client.ts'
import { ViewerProvider, useViewer } from '../viewer.tsx'
import { Invite } from './Invite.tsx'

afterEach(cleanup)

const stub = (over: Partial<InviteApi> = {}): InviteApi => ({
  getInviteState: () => Promise.resolve({ status: 'outstanding' }),
  redeemInvite: () => Promise.reject(new Error('redeemInvite is not stubbed here')),
  ...over,
})

/** Renders the shared viewer's state, so a test can see it change. */
const ViewerProbe = () => <p data-testid="viewer">{useViewer().status}</p>

const renderPage = (api: InviteApi, viewer: Viewer = { status: 'signed-out' }) =>
  render(
    <ViewerProvider viewer={viewer}>
      <Invite api={api} token="a-token" />
      <ViewerProbe />
    </ViewerProvider>,
  )

const fill = (label: string, value: string) => {
  fireEvent.input(screen.getByLabelText(label, { exact: false }), { target: { value } })
}

const complete = () => {
  fill('Email', 'fredrik@example.org')
  fill('Password', 'a-password')
  fill('Your name', 'Fredrik')
}

const join = () => screen.getByRole('button', { name: 'Join' }).click()

const withState = (status: InviteState['status']) =>
  stub({ getInviteState: () => Promise.resolve({ status }) })

describe('Invite', () => {
  it('offers the form for a live invite', async () => {
    renderPage(stub())

    expect(await screen.findByRole('button', { name: 'Join' })).toBeTruthy()
  })

  it('sends what was filled in', async () => {
    const redeemInvite = vi.fn(() => Promise.resolve({ viewer: null }))
    renderPage(stub({ redeemInvite }))

    await screen.findByRole('button', { name: 'Join' })
    complete()
    fill('Allergies', 'peanuts')
    join()

    await waitFor(() =>
      expect(redeemInvite).toHaveBeenCalledWith('a-token', {
        email: 'fredrik@example.org',
        password: 'a-password',
        name: 'Fredrik',
        allergies_notes: 'peanuts',
      }),
    )
  })

  it('sends null rather than an empty string when allergies are left blank', async () => {
    // The column is nullable and "not said" has one representation; an empty
    // string would read as "asked and answered nothing".
    const redeemInvite = vi.fn(() => Promise.resolve({ viewer: null }))
    renderPage(stub({ redeemInvite }))

    await screen.findByRole('button', { name: 'Join' })
    complete()
    join()

    await waitFor(() =>
      expect(redeemInvite).toHaveBeenCalledWith(
        'a-token',
        expect.objectContaining({ allergies_notes: null }),
      ),
    )
  })

  it('confirms once they are in', async () => {
    renderPage(stub({ redeemInvite: () => Promise.resolve({ viewer: null }) }))

    await screen.findByRole('button', { name: 'Join' })
    complete()
    join()

    expect((await screen.findByRole('status')).textContent).toContain('signed in')
  })

  it('signs them into the shared viewer, not just the cookie', async () => {
    // The session cookie is set server-side, but `Layout`'s nav reads the shared
    // viewer, which is populated once on mount and not refetched on client-side
    // navigation. Without this the newly-joined member clicks through to the
    // start page and is still offered "Log in".
    renderPage(
      stub({
        redeemInvite: () => Promise.resolve({ viewer: { account_id: 'a-1', roles: ['member' as const] } }),
      }),
    )

    await screen.findByRole('button', { name: 'Join' })
    complete()
    join()

    await waitFor(() => expect(screen.getByTestId('viewer').textContent).toBe('signed-in'))
  })

  for (const [status, expected] of [
    ['expired', /expired/],
    ['used', /already been used/],
    ['unknown', /do not recognise/],
  ] as const) {
    it(`explains a ${status} invite on its own page, with no form`, async () => {
      // Three dead ends with three different things to do about them, which is why
      // this is a status rather than one error code.
      renderPage(withState(status))

      expect((await screen.findByRole('alert')).textContent).toMatch(expected)
      expect(screen.queryByRole('button', { name: 'Join' })).toBeNull()
    })
  }

  it('takes a password of any shape, since what makes a good one is theirs to decide', async () => {
    const redeemInvite = vi.fn(() => Promise.resolve({ viewer: null }))
    renderPage(stub({ redeemInvite }))

    await screen.findByRole('button', { name: 'Join' })
    complete()
    fill('Password', 'hi')
    join()

    await waitFor(() =>
      expect(redeemInvite).toHaveBeenCalledWith('a-token', expect.objectContaining({ password: 'hi' })),
    )
  })

  it('asks for a password, a blank one being no password at all', async () => {
    const redeemInvite = vi.fn(() => Promise.resolve({ viewer: null }))
    renderPage(stub({ redeemInvite }))

    await screen.findByRole('button', { name: 'Join' })
    complete()
    fill('Password', '')
    join()

    expect((await screen.findByRole('alert')).textContent).toContain('choose a password')
    expect(redeemInvite).not.toHaveBeenCalled()
  })

  it('never asks how to reach them, the email it just took being the answer', async () => {
    const redeemInvite = vi.fn(() => Promise.resolve({ viewer: null }))
    renderPage(stub({ redeemInvite }))

    await screen.findByRole('button', { name: 'Join' })
    expect(screen.queryByLabelText(/reach you/)).toBeNull()
    complete()
    join()

    await waitFor(() =>
      expect(redeemInvite).toHaveBeenCalledWith(
        'a-token',
        expect.not.objectContaining({ contact: expect.anything() }),
      ),
    )
  })

  it('puts the complaint by the button that was clicked, and focuses it', async () => {
    // The reported symptom: on a phone this form is taller than the screen, so an
    // error rendered above the first field is off screen when Join is tapped and
    // the button reads as broken. Both halves are asserted — placement after the
    // button in document order, and focus, which is what scrolls it into view.
    renderPage(stub())

    await screen.findByRole('button', { name: 'Join' })
    complete()
    fill('Your name', '   ')
    join()

    const alert = await screen.findByRole('alert')
    const button = screen.getByRole('button', { name: 'Join' })

    expect(document.activeElement).toBe(alert)
    expect(button.previousElementSibling).toBe(alert)
  })

  it('refuses a blank name', async () => {
    const redeemInvite = vi.fn(() => Promise.resolve({ viewer: null }))
    renderPage(stub({ redeemInvite }))

    await screen.findByRole('button', { name: 'Join' })
    complete()
    fill('Your name', '   ')
    join()

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(redeemInvite).not.toHaveBeenCalled()
  })

  it('tells them to ask for a fresh link when the invite went while the page was open', async () => {
    // A 409 is not worth retrying — the same request fails the same way.
    renderPage(stub({ redeemInvite: () => Promise.reject(apiError(409, 'conflict', 'nope')) }))

    await screen.findByRole('button', { name: 'Join' })
    complete()
    join()

    expect((await screen.findByRole('alert')).textContent).toContain('fresh link')
  })

  it('says a transport failure is worth retrying, unlike a conflict', async () => {
    renderPage(stub({ redeemInvite: () => Promise.reject(new TypeError('Failed to fetch')) }))

    await screen.findByRole('button', { name: 'Join' })
    complete()
    join()

    expect((await screen.findByRole('alert')).textContent).toContain('try again')
  })

  it('does not offer redemption to someone already signed in', async () => {
    // It would create a second account for the same human, and the page cannot
    // tell whether that is what they meant.
    const getInviteState = vi.fn(() => Promise.resolve({ status: 'outstanding' as const }))
    renderPage(stub({ getInviteState }), {
      status: 'signed-in',
      account: { id: 'a-1', roles: ['member'] },
    })

    expect(screen.getByText(/already signed in/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull()
  })

  it('surfaces a failure to check the invite rather than showing a form', async () => {
    renderPage(stub({ getInviteState: () => Promise.reject(new Error('nope')) }))

    expect((await screen.findByRole('alert')).textContent).toContain('reload')
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull()
  })
})
