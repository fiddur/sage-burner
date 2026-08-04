import type { Event, LeadRole, MyBurn } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { RolesApi } from './Roles.tsx'

import { apiError } from '../api/client.ts'
import { BurnProvider } from '../burn.tsx'
import { ViewerProvider } from '../viewer.tsx'
import { Roles } from './Roles.tsx'

afterEach(cleanup)

const ADA: Viewer = { status: 'signed-in', account: { id: 'a-1', name: null, roles: ['member'] } }
const ORGANISER: Viewer = { status: 'signed-in', account: { id: 'a-9', name: null, roles: ['admin'] } }

const BURN: Event = {
  id: 'e-1',
  name: 'Summer burn',
  slug: 'summer-burn',
  start_date: '2026-08-01',
  end_date: '2026-08-05',
  member_cap: 42,
  start_time: '16:00',
  end_time: '12:00',
  welcome_markdown: '',
  created_at: '2026-01-01T00:00:00.000Z',
}

const aRole = (over: Partial<LeadRole> & Pick<LeadRole, 'id' | 'title'>): LeadRole => ({
  event_id: 'e-1',
  purpose: '',
  tasks: '',
  effort_before: 'none',
  effort_during: 'none',
  effort_after: 'none',
  team_size_wanted: 0,
  lead: null,
  team: [],
  created_at: '2026-01-01T00:00:00.000Z',
  ...over,
})

const stub = (
  over: Partial<RolesApi> = {},
  roles: LeadRole[] = [],
  attendees = [
    { account_id: 'a-1', name: 'Ada' },
    { account_id: 'a-2', name: 'Bea' },
  ],
): RolesApi => ({
  getLeadRoles: () => Promise.resolve({ roles }),
  getEventAttendees: () => Promise.resolve({ attendees }),
  getLeadRoleSources: () => Promise.resolve({ sources: [] }),
  addLeadRole: () => Promise.reject(new Error('addLeadRole is not stubbed here')),
  updateLeadRole: () => Promise.reject(new Error('updateLeadRole is not stubbed here')),
  deleteLeadRole: () => Promise.reject(new Error('deleteLeadRole is not stubbed here')),
  setLeadRoleLead: () => Promise.reject(new Error('setLeadRoleLead is not stubbed here')),
  joinLeadRoleTeam: () => Promise.reject(new Error('joinLeadRoleTeam is not stubbed here')),
  leaveLeadRoleTeam: () => Promise.reject(new Error('leaveLeadRoleTeam is not stubbed here')),
  copyLeadRoles: () => Promise.reject(new Error('copyLeadRoles is not stubbed here')),
  ...over,
})

/** The selector's view of the same burn, so the two cannot describe different ones. */
const CHOSEN: MyBurn = { event: BURN, attendance: null }

// `null`, not `undefined`: passing `undefined` to a parameter with a default gets
// the default, so "no burn" written that way silently rendered the usual one.
const renderPage = (api: RolesApi, viewer: Viewer = ADA, burn: MyBurn | null = CHOSEN) =>
  render(
    <ViewerProvider viewer={viewer}>
      <BurnProvider
        value={{ status: 'ready', burns: burn === null ? [] : [burn], selected: burn ?? undefined }}
      >
        <Roles api={api} />
      </BurnProvider>
    </ViewerProvider>,
  )

describe('Roles', () => {
  it('says so when nobody has written one down yet', async () => {
    renderPage(stub())

    expect(await screen.findByText(/No roles yet/)).toBeTruthy()
  })

  it('shows a vacant role as vacant rather than blank', async () => {
    renderPage(stub({}, [aRole({ id: 'r-1', title: 'Sauna' })]))

    expect(await screen.findByText('Sauna')).toBeTruthy()
    expect(screen.getByText(/Nobody has taken this on yet/)).toBeTruthy()
  })

  it('names the lead when somebody holds it', async () => {
    renderPage(stub({}, [aRole({ id: 'r-1', title: 'Sauna', lead: { account_id: 'a-2', name: 'Bea' } })]))

    expect(await screen.findByText('Led by Bea')).toBeTruthy()
  })

  it('shows how many the team wants without ever refusing another', async () => {
    // Advisory, per #27: a full role still offers "join". The lodging list's rule —
    // disable when full — is the one this must not copy, because a bed is finite and
    // a pair of hands is not.
    const joinLeadRoleTeam = vi.fn(() => Promise.resolve({ role: aRole({ id: 'r-1', title: 'Kitchen' }) }))
    renderPage(
      stub({ joinLeadRoleTeam }, [
        aRole({
          id: 'r-1',
          title: 'Kitchen',
          team_size_wanted: 1,
          team: [{ account_id: 'a-2', name: 'Bea' }],
        }),
      ]),
    )

    const join = await screen.findByRole('button', { name: 'Join the team' })
    expect(screen.getByText('1 of 1 wanted')).toBeTruthy()
    expect(join.hasAttribute('disabled')).toBe(false)

    fireEvent.click(join)

    await waitFor(() => {
      expect(joinLeadRoleTeam).toHaveBeenCalledWith('r-1', 'a-1')
    })
  })

  it('renders the purpose as markdown, not as raw html', async () => {
    // Members author this, and `markdown.ts` escapes rather than filters — so a
    // script tag typed into the purpose must come out as text.
    renderPage(
      stub({}, [aRole({ id: 'r-1', title: 'Sauna', purpose: '**Keep it hot**<script>alert(1)</script>' })]),
    )

    expect(await screen.findByText('Keep it hot')).toBeTruthy()
    expect(document.querySelector('script')).toBeNull()
    expect(document.body.textContent).toContain('<script>alert(1)</script>')
  })

  it('names all three effort answers separately', async () => {
    renderPage(
      stub({}, [
        aRole({
          id: 'r-1',
          title: 'Build',
          effort_before: 'high',
          effort_during: 'low',
          effort_after: 'none',
        }),
      ]),
    )

    expect(await screen.findByText(/a lot before, a little during, none after/)).toBeTruthy()
  })

  it('adds a role from its title alone', async () => {
    const addLeadRole = vi.fn(() => Promise.resolve({ role: aRole({ id: 'r-1', title: 'Sauna' }) }))
    renderPage(stub({ addLeadRole }))

    fireEvent.input(await screen.findByLabelText('What needs looking after?'), {
      target: { value: '  Sauna  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }))

    await waitFor(() => {
      expect(addLeadRole).toHaveBeenCalledWith('e-1', { title: 'Sauna' })
    })
  })

  it('refuses to add a nameless role without asking the server', async () => {
    const addLeadRole = vi.fn(() => Promise.resolve({ role: aRole({ id: 'r-1', title: 'x' }) }))
    renderPage(stub({ addLeadRole }))

    fireEvent.input(await screen.findByLabelText('What needs looking after?'), {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }))

    expect(await screen.findByText('Give the role a name.')).toBeTruthy()
    expect(addLeadRole).not.toHaveBeenCalled()
  })

  it('hands the role to somebody, and vacates it', async () => {
    const setLeadRoleLead = vi.fn(() => Promise.resolve({ role: aRole({ id: 'r-1', title: 'Sauna' }) }))
    renderPage(
      stub({ setLeadRoleLead }, [
        aRole({ id: 'r-1', title: 'Sauna', lead: { account_id: 'a-2', name: 'Bea' } }),
      ]),
    )

    const lead = await screen.findByLabelText('Lead of Sauna')
    fireEvent.change(lead, { target: { value: 'a-1' } })
    await waitFor(() => {
      expect(setLeadRoleLead).toHaveBeenCalledWith('r-1', 'a-1')
    })

    fireEvent.change(await screen.findByLabelText('Lead of Sauna'), { target: { value: '' } })
    await waitFor(() => {
      expect(setLeadRoleLead).toHaveBeenLastCalledWith('r-1', null)
    })
  })

  it('asks before removing a role, because there is no undo', async () => {
    const deleteLeadRole = vi.fn(() => Promise.resolve(undefined))
    renderPage(
      stub({ deleteLeadRole }, [
        aRole({ id: 'r-1', title: 'Sauna', team: [{ account_id: 'a-2', name: 'Bea' }] }),
      ]),
    )

    fireEvent.click(await screen.findByLabelText('Remove Sauna'))

    expect(screen.getByText('Remove Sauna and everyone on it?')).toBeTruthy()
    expect(deleteLeadRole).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText('Really remove Sauna'))

    await waitFor(() => {
      expect(deleteLeadRole).toHaveBeenCalledWith('r-1')
    })
  })

  it('lets a member remove a role somebody else leads', async () => {
    // The deliberate divergence. A page that hid this button for anyone but the
    // lead would be enforcing a rule the server does not have.
    const deleteLeadRole = vi.fn(() => Promise.resolve(undefined))
    renderPage(
      stub({ deleteLeadRole }, [
        aRole({ id: 'r-1', title: 'Sauna', lead: { account_id: 'a-2', name: 'Bea' } }),
      ]),
    )

    fireEvent.click(await screen.findByLabelText('Remove Sauna'))
    fireEvent.click(screen.getByLabelText('Really remove Sauna'))

    await waitFor(() => {
      expect(deleteLeadRole).toHaveBeenCalledWith('r-1')
    })
  })

  it('sends only the fields the edit form changed', async () => {
    // Several people share this page. Sending all seven would put back whatever
    // somebody else edited between this form's mount and its save.
    const updateLeadRole = vi.fn(() => Promise.resolve({ role: aRole({ id: 'r-1', title: 'Sauna' }) }))
    renderPage(
      stub({ updateLeadRole }, [
        aRole({ id: 'r-1', title: 'Sauna', purpose: 'Keep it hot', team_size_wanted: 2 }),
      ]),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(await screen.findByLabelText('Effort during Sauna'), { target: { value: 'high' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(updateLeadRole).toHaveBeenCalledWith('r-1', { effort_during: 'high' })
    })
  })

  it('treats an emptied team size as unchanged rather than as nobody wanted', async () => {
    // `Number('')` is 0, so clearing the box used to save "none asked for" — which
    // the page then shows as a decision somebody made.
    const updateLeadRole = vi.fn(() => Promise.resolve({ role: aRole({ id: 'r-1', title: 'Sauna' }) }))
    renderPage(stub({ updateLeadRole }, [aRole({ id: 'r-1', title: 'Sauna', team_size_wanted: 3 })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.input(await screen.findByLabelText('Team wanted for Sauna'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Effort during Sauna'), { target: { value: 'high' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(updateLeadRole).toHaveBeenCalledWith('r-1', { effort_during: 'high' })
    })
  })

  it('still saves a team size that was actually typed', async () => {
    // The passing sibling: "empty means unchanged" must not swallow a real edit.
    const updateLeadRole = vi.fn(() => Promise.resolve({ role: aRole({ id: 'r-1', title: 'Sauna' }) }))
    renderPage(stub({ updateLeadRole }, [aRole({ id: 'r-1', title: 'Sauna', team_size_wanted: 3 })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.input(await screen.findByLabelText('Team wanted for Sauna'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(updateLeadRole).toHaveBeenCalledWith('r-1', { team_size_wanted: 5 })
    })
  })

  it('takes somebody off the team by name', async () => {
    const leaveLeadRoleTeam = vi.fn(() => Promise.resolve(undefined))
    renderPage(
      stub({ leaveLeadRoleTeam }, [
        aRole({ id: 'r-1', title: 'Sauna', team: [{ account_id: 'a-2', name: 'Bea' }] }),
      ]),
    )

    fireEvent.click(await screen.findByLabelText('Take Bea off Sauna'))

    await waitFor(() => {
      expect(leaveLeadRoleTeam).toHaveBeenCalledWith('r-1', 'a-2')
    })
  })

  it('puts somebody else on the team', async () => {
    const joinLeadRoleTeam = vi.fn(() => Promise.resolve({ role: aRole({ id: 'r-1', title: 'Sauna' }) }))
    renderPage(stub({ joinLeadRoleTeam }, [aRole({ id: 'r-1', title: 'Sauna' })]))

    fireEvent.change(await screen.findByLabelText('Add somebody to Sauna'), { target: { value: 'a-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add them' }))

    await waitFor(() => {
      expect(joinLeadRoleTeam).toHaveBeenCalledWith('r-1', 'a-2')
    })
  })

  it('offers no "join the team" to an organiser who is not coming', async () => {
    // An admin who is not attending can still set the register up — the roles are
    // held by an attendance, so there is nothing for them to join.
    renderPage(stub({}, [aRole({ id: 'r-1', title: 'Sauna' })]), ORGANISER)

    expect(await screen.findByText('Sauna')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Join the team' })).toBeNull()
  })

  it('offers a previous burn only while the register is empty', async () => {
    const copyLeadRoles = vi.fn(() => Promise.resolve({ roles: [] }))
    const sources = { sources: [{ event_id: 'e-0', name: 'Last summer', count: 3 }] }
    const { unmount } = renderPage(
      stub({ copyLeadRoles, getLeadRoleSources: () => Promise.resolve(sources) }),
    )

    // The note says what a copy leaves behind — it is not derivable from the button,
    // and it was dropped once when this control was extracted.
    expect(await screen.findByText('The roles themselves, not who held them.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Copy those roles' }))
    await waitFor(() => {
      expect(copyLeadRoles).toHaveBeenCalledWith('e-1', 'e-0')
    })
    unmount()

    renderPage(
      stub({ getLeadRoleSources: () => Promise.resolve(sources) }, [aRole({ id: 'r-1', title: 'Sauna' })]),
    )

    expect(await screen.findByText('Sauna')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Copy those roles' })).toBeNull()
  })

  it('says there is nothing to look after when no burn is coming up', async () => {
    renderPage(stub(), ADA, null)

    expect(await screen.findByText(/no burn coming up yet/)).toBeTruthy()
  })

  it('shows the server’s message when a change is refused', async () => {
    renderPage(
      stub(
        {
          deleteLeadRole: () => Promise.reject(apiError(403, 'forbidden', 'You do not have access to that.')),
        },
        [aRole({ id: 'r-1', title: 'Sauna' })],
      ),
    )

    fireEvent.click(await screen.findByLabelText('Remove Sauna'))
    fireEvent.click(screen.getByLabelText('Really remove Sauna'))

    expect(await screen.findByText('You do not have access to that.')).toBeTruthy()
  })

  it('sends a signed-out visitor to log in rather than to an empty register', async () => {
    renderPage(stub(), { status: 'signed-out' })

    expect(screen.getByText(/This is for members/)).toBeTruthy()
  })
})
