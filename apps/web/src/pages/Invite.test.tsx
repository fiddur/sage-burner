import type { Attendance, Event, EventOptionTaken, InviteState } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { InviteApi } from './Invite.tsx'

import { apiError } from '../api/client.ts'
import { useViewer, ViewerProvider } from '../viewer.tsx'
import { Invite } from './Invite.tsx'

afterEach(cleanup)

const aBurn = (over: Partial<Event> = {}): Event => ({
  id: 'e-1',
  name: 'Summer burn',
  slug: 'summer-burn',
  start_date: '2026-08-01',
  end_date: '2026-08-03',
  start_time: '16:00',
  end_time: '12:00',
  location: '',
  welcome_markdown: '',
  payment_info_markdown: '',
  transfer_info_markdown: '',
  member_cap: 42,
  created_at: '2026-07-02T00:00:00.000Z',
  ...over,
})

const anAttendance = (over: Partial<Attendance> = {}): Attendance => ({
  id: 'att-1',
  event_id: 'e-1',
  account_id: 'a-1',
  joined_at: '2026-07-02T00:00:00.000Z',
  arrival_date: '2026-08-01',
  departure_date: '2026-08-03',
  lodging_option_id: null,
  helping_option_ids: [],
  helping_other: null,
  notes: null,
  payment_status: 'unpaid',
  payment_date: null,
  ...over,
})

/**
 * No burn on offer by default, so the tests that predate #224 see the form they were
 * written against. `withBurn` is what turns the checkbox and the stay questions on.
 */
const stub = (over: Partial<InviteApi> = {}): InviteApi => ({
  getAllergyItems: () => Promise.resolve({ items: [] }),
  getInviteState: () => Promise.resolve({ status: 'outstanding', name: null, email: null }),
  redeemInvite: () => Promise.reject(new Error('redeemInvite is not stubbed here')),
  getActiveEvent: () => Promise.resolve({ event: null }),
  getEventOptions: () => Promise.resolve({ options: [] }),
  updateMyStay: () => Promise.reject(new Error('updateMyStay is not stubbed here')),
  joinEvent: () => Promise.reject(new Error('joinEvent is not stubbed here')),
  ...over,
})

const withBurn = (over: Partial<InviteApi> = {}, options: EventOptionTaken[] = []): InviteApi =>
  stub({
    getActiveEvent: () => Promise.resolve({ event: aBurn() }),
    getEventOptions: () => Promise.resolve({ options }),
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
  stub({ getInviteState: () => Promise.resolve({ status, name: null, email: null }) })

describe('Invite', () => {
  it('offers the form for a live invite', async () => {
    renderPage(stub())

    expect(await screen.findByRole('button', { name: 'Join' })).toBeTruthy()
  })

  it('sends what was filled in', async () => {
    const redeemInvite = vi.fn(() => Promise.resolve({ viewer: null, attendance: null }))
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
        allergy_item_ids: [],
        // No burn on offer, so nothing to join — said explicitly rather than left off.
        join_event_id: null,
      }),
    )
  })

  it('sends null rather than an empty string when allergies are left blank', async () => {
    // The column is nullable and "not said" has one representation; an empty
    // string would read as "asked and answered nothing".
    const redeemInvite = vi.fn(() => Promise.resolve({ viewer: null, attendance: null }))
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
    renderPage(stub({ redeemInvite: () => Promise.resolve({ viewer: null, attendance: null }) }))

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
        redeemInvite: () =>
          Promise.resolve({
            viewer: { account_id: 'a-1', name: null, avatar: null, roles: ['member' as const] },
            attendance: null,
          }),
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
    const redeemInvite = vi.fn(() => Promise.resolve({ viewer: null, attendance: null }))
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
    const redeemInvite = vi.fn(() => Promise.resolve({ viewer: null, attendance: null }))
    renderPage(stub({ redeemInvite }))

    await screen.findByRole('button', { name: 'Join' })
    complete()
    fill('Password', '')
    join()

    expect((await screen.findByRole('alert')).textContent).toContain('choose a password')
    expect(redeemInvite).not.toHaveBeenCalled()
  })

  it('never asks how to reach them, the email it just took being the answer', async () => {
    const redeemInvite = vi.fn(() => Promise.resolve({ viewer: null, attendance: null }))
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

  it('says it again on a second attempt, rather than looking broken twice', async () => {
    // The first tap focuses the alert. If the second tap does not, someone who
    // scrolled off to look at a field is left with a button that appears to do
    // nothing — which is the whole symptom this is here to fix, reappearing on
    // attempt two. Both `setError` calls land in one commit, so the message that
    // reaches the DOM is unchanged and only the attempt tells them apart.
    renderPage(stub())

    await screen.findByRole('button', { name: 'Join' })
    complete()
    fill('Your name', '   ')
    join()

    const alert = await screen.findByRole('alert')
    alert.blur()
    expect(document.activeElement).not.toBe(alert)

    join()

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('alert')))
  })

  it('leaves the focus alone while they are typing the fix', async () => {
    // The other half of the same rule: refocusing on every render would snatch
    // the caret out of the field mid-correction.
    renderPage(stub())

    await screen.findByRole('button', { name: 'Join' })
    complete()
    fill('Your name', '   ')
    join()
    await screen.findByRole('alert')

    const nameBox = screen.getByLabelText('Your name')
    nameBox.focus()
    fill('Your name', 'Fredrik')

    expect(document.activeElement).toBe(nameBox)
  })

  it('refuses a blank name', async () => {
    const redeemInvite = vi.fn(() => Promise.resolve({ viewer: null, attendance: null }))
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

  it('says to wait rather than to check the connection when the server is at capacity', async () => {
    // A 429 is the server bounding how much password hashing it runs at once.
    // Nothing is wrong with their connection, and waiting a moment does work —
    // which is the opposite of what the generic message tells them to do.
    renderPage(stub({ redeemInvite: () => Promise.reject(apiError(429, 'rate_limited', 'nope')) }))

    await screen.findByRole('button', { name: 'Join' })
    complete()
    join()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Wait a few seconds')
    expect(alert.textContent).not.toContain('connection')
  })

  it('passes on the connection advice for a request that never reached a server', async () => {
    // What the client actually raises for a dead network since it started
    // mapping them: `ApiError(0, 'network')`, whose message already says what to
    // do. This is the one branch where advice about a connection is right, and it
    // was the one branch that did not give it.
    renderPage(
      stub({
        redeemInvite: () =>
          Promise.reject(
            apiError(0, 'network', 'Could not reach the server. Check your connection and try again.'),
          ),
      }),
    )

    await screen.findByRole('button', { name: 'Join' })
    complete()
    join()

    expect((await screen.findByRole('alert')).textContent).toContain('Check your connection')
  })

  it("does not render the page's own cancellation at someone", async () => {
    // `aborted` shares status 0 with `network`, and "Request cancelled." is the
    // page tidying up after itself rather than anything the member did.
    renderPage(stub({ redeemInvite: () => Promise.reject(apiError(0, 'aborted', 'Request cancelled.')) }))

    await screen.findByRole('button', { name: 'Join' })
    complete()
    join()

    expect((await screen.findByRole('alert')).textContent).not.toContain('cancelled')
  })

  it('does not blame the connection for a failure that arrived as a response', async () => {
    // The passing sibling, and the inversion it caught: a 500 is the server
    // answering, so "check your connection" sends them after the wrong thing.
    renderPage(stub({ redeemInvite: () => Promise.reject(apiError(500, 'internal', 'nope')) }))

    await screen.findByRole('button', { name: 'Join' })
    complete()
    join()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('try again')
    expect(alert.textContent).not.toContain('connection')
  })

  it('does not offer redemption to someone already signed in', async () => {
    // It would create a second account for the same human, and the page cannot
    // tell whether that is what they meant.
    const getInviteState = vi.fn(() =>
      Promise.resolve({ status: 'outstanding' as const, name: null, email: null }),
    )
    renderPage(stub({ getInviteState }), {
      status: 'signed-in',
      account: { id: 'a-1', name: null, avatar: null, roles: ['member'] },
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

describe('the name the applicant already gave', () => {
  it('starts the form from it, rather than asking twice', async () => {
    renderPage(
      stub({ getInviteState: () => Promise.resolve({ status: 'outstanding', name: 'Ada', email: null }) }),
    )

    expect(await screen.findByLabelText('Your name', { exact: false })).toHaveProperty('value', 'Ada')
  })

  it('starts the address from it too, since the invite arrived there', async () => {
    // #30. Asking for the address the message it came in was addressed to is worse
    // than not listening.
    renderPage(
      stub({
        getInviteState: () =>
          Promise.resolve({ status: 'outstanding', name: 'Ada', email: 'ada@example.org' }),
      }),
    )

    expect(await screen.findByLabelText('Email', { exact: false })).toHaveProperty('value', 'ada@example.org')
  })

  it('leaves the address blank for an invite nobody applied for', async () => {
    // An admin's direct invite has no application behind it.
    renderPage(stub())

    expect(await screen.findByLabelText('Email', { exact: false })).toHaveProperty('value', '')
  })

  it('leaves it blank for an invite nobody applied for', async () => {
    // An admin's direct invite has no application behind it, and is still a
    // perfectly good invite.
    renderPage(stub())

    expect(await screen.findByLabelText('Your name', { exact: false })).toHaveProperty('value', '')
  })

  it('is still the reader’s to change', async () => {
    renderPage(
      stub({ getInviteState: () => Promise.resolve({ status: 'outstanding', name: 'Ada', email: null }) }),
    )

    fireEvent.input(await screen.findByLabelText('Your name', { exact: false }), {
      target: { value: 'Ada Lovelace' },
    })

    expect(screen.getByLabelText('Your name', { exact: false })).toHaveProperty('value', 'Ada Lovelace')
  })
})

/**
 * #224. Almost everybody spending an invite is joining the burn that is coming, so
 * the form says so — and asks for the stay details in the same breath, rather than
 * leaving a new member to find a second page.
 */
describe('joining the upcoming burn from the form', () => {
  it('offers it by name, already ticked', async () => {
    renderPage(withBurn())

    const box = await screen.findByLabelText(/I am coming to Summer burn/)
    expect(box).toHaveProperty('checked', true)
  })

  it('asks nothing about a burn when there is none coming', async () => {
    // A fresh installation, or the gap after the last one ends. `activeEvent` is
    // deliberately null there rather than falling back to a past burn.
    renderPage(stub())

    await screen.findByRole('button', { name: 'Join' })
    expect(screen.queryByLabelText(/I am coming to/)).toBeNull()
    expect(screen.queryByLabelText('Arriving')).toBeNull()
  })

  it('sends the burn and the stay together', async () => {
    const redeemInvite = vi.fn(() => Promise.resolve({ viewer: null, attendance: anAttendance() }))
    const updateMyStay = vi.fn(() => Promise.resolve({ attendance: anAttendance() }))
    renderPage(withBurn({ redeemInvite, updateMyStay }))

    await screen.findByRole('button', { name: 'Join' })
    complete()
    fill('Anything else', 'arriving by train')
    join()

    await waitFor(() =>
      expect(redeemInvite).toHaveBeenCalledWith('a-token', expect.objectContaining({ join_event_id: 'e-1' })),
    )
    await waitFor(() =>
      expect(updateMyStay).toHaveBeenCalledWith(
        'e-1',
        expect.objectContaining({ notes: 'arriving by train' }),
      ),
    )
  })

  it('starts the stay at the whole burn, which is what almost everybody means', async () => {
    renderPage(withBurn())

    expect(await screen.findByLabelText('Arriving')).toHaveProperty('value', '2026-08-01')
    expect(screen.getByLabelText('Leaving')).toHaveProperty('value', '2026-08-03')
  })

  it('asks nothing about the stay once the box is unticked', async () => {
    // An admin who is setting the burn up without attending it.
    const redeemInvite = vi.fn(() => Promise.resolve({ viewer: null, attendance: null }))
    renderPage(withBurn({ redeemInvite }))

    fireEvent.click(await screen.findByLabelText(/I am coming to Summer burn/))
    expect(screen.queryByLabelText('Arriving')).toBeNull()

    complete()
    join()

    await waitFor(() =>
      expect(redeemInvite).toHaveBeenCalledWith('a-token', expect.objectContaining({ join_event_id: null })),
    )
  })

  it('saves nothing about a stay the server did not create', async () => {
    // The burn ended while the form was open. The account is made, the join is
    // skipped, and a stay update against a burn nobody joined would only 404.
    const updateMyStay = vi.fn(() => Promise.resolve({ attendance: anAttendance() }))
    renderPage(
      withBurn({ redeemInvite: () => Promise.resolve({ viewer: null, attendance: null }), updateMyStay }),
    )

    await screen.findByRole('button', { name: 'Join' })
    complete()
    join()

    // The member welcome, which offers the burn now rather than describing one.
    expect(await screen.findByRole('button', { name: /Summer burn/ })).toBeTruthy()
    expect(updateMyStay).not.toHaveBeenCalled()
    // And quietly: not reaching for `attendance.event_id` at all. Dropping the null
    // guard still calls nothing — it throws on the property first — so a test that
    // only counted calls would pass against it and report a failure to the reader.
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says they are in even when the details did not save', async () => {
    // The token is spent and cannot be spent again, so the second write failing must
    // not read as a signup that failed.
    renderPage(
      withBurn({
        redeemInvite: () => Promise.resolve({ viewer: null, attendance: anAttendance() }),
        updateMyStay: () => Promise.reject(apiError(500, 'internal_error', 'nope')),
      }),
    )

    await screen.findByRole('button', { name: 'Join' })
    complete()
    join()

    expect((await screen.findByRole('status')).textContent).toContain('on the list')
    expect((await screen.findByRole('alert')).textContent).toContain('did not save')
  })

  it('refuses a departure before the arrival without spending the invite', async () => {
    const redeemInvite = vi.fn(() => Promise.resolve({ viewer: null, attendance: anAttendance() }))
    renderPage(withBurn({ redeemInvite }))

    await screen.findByRole('button', { name: 'Join' })
    complete()
    fireEvent.input(screen.getByLabelText('Leaving'), { target: { value: '2026-07-30' } })
    join()

    expect((await screen.findByRole('alert')).textContent).toContain('before your arrival')
    expect(redeemInvite).not.toHaveBeenCalled()
  })

  it('still signs them up when the burn cannot be fetched at all', async () => {
    // The invite is what this page is for. Somebody who cannot be offered a burn can
    // still become a member and pick one afterwards.
    const redeemInvite = vi.fn(() => Promise.resolve({ viewer: null, attendance: null }))
    renderPage(
      stub({ getActiveEvent: () => Promise.reject(apiError(500, 'internal_error', 'nope')), redeemInvite }),
    )

    await screen.findByRole('button', { name: 'Join' })
    expect(screen.queryByLabelText(/I am coming to/)).toBeNull()
    complete()
    join()

    await waitFor(() => expect(redeemInvite).toHaveBeenCalled())
  })

  it('shows the lodging list, and marks a full one full', async () => {
    renderPage(
      withBurn({}, [
        {
          id: 'o-1',
          event_id: 'e-1',
          kind: 'lodging',
          order: 0,
          label: 'Temple mattress',
          capacity: 2,
          taken: 2,
        },
        {
          id: 'o-2',
          event_id: 'e-1',
          kind: 'lodging',
          order: 1,
          label: 'Own tent',
          capacity: null,
          taken: 0,
        },
        { id: 'o-3', event_id: 'e-1', kind: 'helping', order: 0, label: 'Sauna', capacity: null, taken: 0 },
      ]),
    )

    const sleeping = await screen.findByLabelText(/Where are you sleeping/)
    expect(sleeping.textContent).toContain('Temple mattress — full')
    expect(sleeping.textContent).toContain('Own tent')
    // The helping list is checkboxes, not options in the sleeping select.
    expect(sleeping.textContent).not.toContain('Sauna')
    expect(screen.getByLabelText('Sauna')).toBeTruthy()
  })

  it('offers no link to the lodging list, which nobody here can reach yet', async () => {
    // The account does not exist while this form is on screen, so `/options` is a
    // page the reader would be bounced off.
    renderPage(withBurn())

    await screen.findByLabelText(/Where are you sleeping/)
    expect(screen.queryByText(/edit lodging alternatives/)).toBeNull()
  })
})

describe('the welcome for somebody who did not join a burn', () => {
  const redeemAsMemberOnly = { redeemInvite: () => Promise.resolve({ viewer: null, attendance: null }) }

  const redeemWithoutJoining = async () => {
    await screen.findByRole('button', { name: 'Join' })
    complete()
    fireEvent.click(screen.getByRole('checkbox'))
    join()
  }

  it('offers the open burn in one click, rather than only a link to the start page', async () => {
    const joinEvent = vi.fn(() => Promise.resolve({ attendance: anAttendance() }))
    renderPage(withBurn({ ...redeemAsMemberOnly, joinEvent }))

    await redeemWithoutJoining()
    ;(await screen.findByRole('button', { name: /Summer burn/ })).click()

    await waitFor(() => expect(joinEvent).toHaveBeenCalledWith('e-1'))
  })

  it('confirms once they are on the list', async () => {
    renderPage(
      withBurn({ ...redeemAsMemberOnly, joinEvent: () => Promise.resolve({ attendance: anAttendance() }) }),
    )

    await redeemWithoutJoining()
    ;(await screen.findByRole('button', { name: /Summer burn/ })).click()

    expect(await screen.findByText(/on the list for Summer burn/)).toBeTruthy()
  })

  it('says plainly there is none, rather than pointing at a burn that is not there', async () => {
    // The passing sibling for the offer above: a page that always said this would
    // satisfy neither, and one that always offered would leave a dead button here.
    renderPage(stub(redeemAsMemberOnly))

    await screen.findByRole('button', { name: 'Join' })
    complete()
    join()

    expect(await screen.findByText(/no burn open to join just now/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Summer burn/ })).toBeNull()
  })

  it('says so when the join fails, rather than claiming a place', async () => {
    renderPage(withBurn({ ...redeemAsMemberOnly, joinEvent: () => Promise.reject(new Error('nope')) }))

    await redeemWithoutJoining()
    ;(await screen.findByRole('button', { name: /Summer burn/ })).click()

    expect(await screen.findByText(/Could not add you to that burn/)).toBeTruthy()
  })

  it('offers no members-only link on a page nobody has an account on yet', async () => {
    // The same stay fields, drawn before the account exists — so the rideshare board
    // and the lodging list are both links that cannot be followed from here (#26).
    renderPage(withBurn())
    await screen.findByLabelText('Your name')

    expect(screen.queryByRole('link', { name: /Looking for a lift/ })).toBeNull()
  })
})
