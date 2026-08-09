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

const ADA: Viewer = {
  status: 'signed-in',
  account: { id: 'a-1', name: null, avatar: null, roles: ['member'] },
}
const ADMIN: Viewer = {
  status: 'signed-in',
  account: { id: 'a-9', name: null, avatar: null, roles: ['admin'] },
}

const BURN: Event = {
  id: 'e-1',
  name: 'Summer burn',
  slug: 'summer-burn',
  start_date: '2026-08-01',
  end_date: '2026-08-05',
  member_cap: 42,
  start_time: '16:00',
  end_time: '12:00',
  location: '',
  welcome_markdown: '',
  payment_info_markdown: '',
  transfer_info_markdown: '',
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
    { account_id: 'a-1', name: 'Ada', avatar: null },
    { account_id: 'a-2', name: 'Bea', avatar: null },
  ],
): RolesApi => ({
  getLeadRoles: () => Promise.resolve({ roles }),
  getEventAttendees: () => Promise.resolve({ attendees }),
  getLeadRoleSources: () => Promise.resolve({ sources: [] }),
  addLeadRole: () => Promise.reject(new Error('addLeadRole is not stubbed here')),
  uploadImage: () => Promise.reject(new Error('uploadImage is not stubbed here')),
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

  it('shows a vacant role as a spot anybody can take', async () => {
    renderPage(stub({}, [aRole({ id: 'r-1', title: 'Sauna' })]))

    expect(await screen.findByText('Sauna')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Take the spot on Sauna lead' })).toBeTruthy()
  })

  it('names the lead when somebody holds it, and offers only to take them off', async () => {
    // A held spot shows its holder and ✕ and nothing else: handing over is unassign
    // then assign, which is two gestures and two people told.
    renderPage(stub({}, [aRole({ id: 'r-1', title: 'Sauna', lead: { account_id: 'a-2', name: 'Bea' } })]))

    expect(await screen.findByText('Bea')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Take Bea off Sauna lead' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Take the spot on Sauna lead' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Appoint someone to Sauna lead' })).toBeNull()
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

    // The one wanted place is filled, so this row is the extra one — the offer that
    // outlives the count, which is the whole of what this is about. It carries the
    // buttons and *not* the word "wanted", since nothing more is asked for.
    const join = await screen.findByRole('button', { name: 'Take the spot on Kitchen' })
    expect(screen.queryByText('wanted')).toBeNull()
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

  it('names all three effort answers separately, in one cell', async () => {
    // One cell since #307, three icons wide — but each phase still says which it is
    // and how much, because 🌱 is a guess until somebody tells you.
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

    // In order, not `arrayContaining`: the three phases hold the same vocabulary, so
    // a containment check passes just as well with before and after swapped.
    const row = (await screen.findByText('Build')).closest('tr')
    const efforts = [...(row?.querySelectorAll('.effort') ?? [])].map((one) => one.textContent)

    expect(efforts).toEqual(['🌱Effort before: a lot', '🔥Effort during: a little', '🧹Effort after: none'])
  })

  it('draws the level as a bar, and none as an empty one', async () => {
    // "None" has to look like an answer somebody gave rather than a cell nobody
    // filled in, which is why the unfilled segments stay drawn.
    renderPage(
      stub({}, [aRole({ id: 'r-1', title: 'Build', effort_before: 'medium', effort_after: 'none' })]),
    )

    const row = (await screen.findByText('Build')).closest('tr')
    const bars = [...(row?.querySelectorAll('.effort-bar') ?? [])]

    expect(bars).toHaveLength(3)
    expect(bars[0]?.querySelectorAll('span')).toHaveLength(3)
    expect(bars[0]?.querySelectorAll('span.is-on')).toHaveLength(2)
    expect(bars[2]?.querySelectorAll('span.is-on')).toHaveLength(0)
  })

  it('says what the effort icons mean, in words, on the page', async () => {
    // `title` needs a hover and `.visually-hidden` needs a screen reader, so a sighted
    // touch user — the case #307 exists for — had three icons and a heading reading
    // only "Effort" (#317).
    renderPage(stub({}, [aRole({ id: 'r-1', title: 'Build' })]))

    const legend = await screen.findByText(/^Effort: /)
    expect(legend.textContent).toContain('🌱 before')
    expect(legend.textContent).toContain('🔥 during')
    expect(legend.textContent).toContain('🧹 after')
  })

  it('gives the body row a cell per heading, and the edit row the whole width', async () => {
    // What the deleted `data-label` test did incidentally: nothing else notices a
    // column added to the header and not to `RoleRow`, or a `colSpan` that stops
    // covering the row (#317). The actions column has no heading text, hence the +1.
    renderPage(stub({}, [aRole({ id: 'r-1', title: 'Build' })]))

    await screen.findByText('Build')
    const headings = document.querySelectorAll('.lead-table thead th')
    const cells = (await screen.findByText('Build')).closest('tr')?.children

    expect(cells).toHaveLength(headings.length)

    fireEvent.click(screen.getByRole('button', { name: 'Edit Build' }))
    const spanning = document.querySelector('.lead-table tbody td[colspan]')

    expect(spanning?.getAttribute('colspan')).toBe(String(headings.length))
  })

  it('keeps the lead and the team apart inside the one column they share', async () => {
    // They were a column each until #307. Merged, the header can no longer say which
    // is which, so each half does — and the two are still two controls with two sets
    // of buttons behind them.
    renderPage(stub({}, [aRole({ id: 'r-1', title: 'Sauna' })]))

    await screen.findByText('Sauna')
    const who = document.querySelector('.lead-who')

    expect([...(who?.querySelectorAll('.lead-who-label') ?? [])].map((one) => one.textContent)).toEqual([
      'Lead',
      'Team',
    ])
    expect(screen.getByRole('button', { name: 'Take the spot on Sauna lead' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Take the spot on Sauna' })).toBeTruthy()
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

    // The two halves of the handover, each from its own render: the stub answers
    // with the same list every time, so one render cannot show both states.
    fireEvent.click(await screen.findByRole('button', { name: 'Take Bea off Sauna lead' }))
    await waitFor(() => {
      expect(setLeadRoleLead).toHaveBeenCalledWith('r-1', null)
    })

    cleanup()
    renderPage(stub({ setLeadRoleLead }, [aRole({ id: 'r-1', title: 'Sauna' })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Take the spot on Sauna lead' }))
    await waitFor(() => {
      expect(setLeadRoleLead).toHaveBeenLastCalledWith('r-1', 'a-1')
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

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Sauna' }))
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

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Sauna' }))
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

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Sauna' }))
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

    fireEvent.click(await screen.findByRole('button', { name: 'Appoint someone to Sauna' }))
    fireEvent.change(screen.getByLabelText('Who to appoint to Sauna'), { target: { value: 'a-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Appoint' }))

    await waitFor(() => {
      expect(joinLeadRoleTeam).toHaveBeenCalledWith('r-1', 'a-2')
    })
  })

  it('offers no "join the team" to an admin who is not coming', async () => {
    // Somebody organising but not attending can still set the register up — the roles are
    // held by an attendance, so there is nothing for them to join.
    renderPage(stub({}, [aRole({ id: 'r-1', title: 'Sauna' })]), ADMIN)

    expect(await screen.findByText('Sauna')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Take the spot on Sauna' })).toBeNull()
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

    expect(await screen.findByText(/not coming to a burn yet/)).toBeTruthy()
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
