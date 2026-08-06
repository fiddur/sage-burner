import type { CopySourcesResponse, EffortLevel, LeadRole, LeadRoleUpdate } from '@sage-burner/shared'

import { effortLevels, MAX_NOTES, MAX_TITLE } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { Loaded } from '../load.ts'

import { useSelectedBurn } from '../burn.tsx'
import { CopyFrom } from '../components/CopyFrom.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { HelperStrip } from '../components/HelperStrip.tsx'
import { MarkdownField } from '../components/MarkdownField.tsx'
import { NoBurn } from '../components/NoBurn.tsx'
import { useAction, useLoad } from '../load.ts'
import { renderMarkdown } from '../markdown.ts'
import { isApproved, useViewer } from '../viewer.tsx'

export type RolesApi = Pick<
  ApiClient,
  | 'getEventAttendees'
  | 'getLeadRoles'
  | 'getLeadRoleSources'
  | 'addLeadRole'
  | 'updateLeadRole'
  | 'deleteLeadRole'
  | 'setLeadRoleLead'
  | 'joinLeadRoleTeam'
  | 'leaveLeadRoleTeam'
  | 'copyLeadRoles'
>

type Person = { account_id: string; name: string | null }
type Source = CopySourcesResponse['sources'][number]

/** Null rather than a fourth status: "no burn is open" is data, not a load outcome. */
type Register = {
  eventId: string
  roles: readonly LeadRole[]
  attendees: readonly Person[]
  sources: readonly Source[]
} | null

const EFFORT_LABEL: Record<EffortLevel, string> = {
  none: 'none',
  low: 'a little',
  medium: 'some',
  high: 'a lot',
}

const nameOf = (person: Person) => person.name ?? 'Someone without a name yet'

/**
 * The header row and, as each cell's `data-label`, what the narrow layout shows in
 * place of the header it hides. Keyed rather than a list so a cell names the one it
 * belongs to, and renaming a column reaches both.
 */
const COLUMNS = {
  title: 'Title',
  purpose: 'Purpose',
  lead: 'Lead',
  tasks: 'Tasks include',
  team: 'Team',
  before: 'Effort before',
  during: 'Effort during',
  after: 'Effort after',
} as const

const HEADINGS = Object.values(COLUMNS)

/**
 * The lead-roles register — who is looking after what at this burn.
 *
 * Two things here would otherwise look like oversights. **The removal button asks
 * first** because any member may remove any role and nothing undoes it. **"Join the
 * team" is never disabled**, however many are wanted — the lodging list greys out a
 * full option and this deliberately does not, because a pair of hands is not a bed.
 */
export const Roles = ({ api }: { api: RolesApi }) => {
  const viewer = useViewer()
  const approved = isApproved(viewer)
  const [title, setTitle] = useState('')
  const [editing, setEditing] = useState<string | undefined>(undefined)

  const burn = useSelectedBurn()
  const { loaded, reload } = useLoad<Register>(
    async (signal) => {
      if (burn === undefined) return null

      const eventId = burn.event.id
      const [roles, attendees, sources] = await Promise.all([
        api.getLeadRoles(eventId, signal),
        api.getEventAttendees(eventId, signal),
        api.getLeadRoleSources(eventId, signal),
      ])

      return {
        eventId,
        roles: roles.roles,
        attendees: attendees.attendees,
        sources: sources.sources,
      }
    },
    { enabled: approved, key: burn?.event.id ?? '', fallback: 'Could not load the roles.' },
  )

  const { busy, error, setError, run } = useAction(reload)

  const ready = loaded.status === 'ready' ? (loaded.data ?? undefined) : undefined

  return (
    <GuardedPage title="Leads" require="approved">
      <h1>Leads</h1>

      <p class="form-note">
        Who is looking after what. Anyone can add a role, take one on, or put somebody else's name to one —
        and anyone can change or remove one, so talk to each other first.
      </p>

      {error !== undefined && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}

      <Notice loaded={loaded} />

      {ready !== undefined && ready.roles.length === 0 && ready.sources.length > 0 && (
        <CopyFrom
          sources={ready.sources}
          what="roles"
          note="The roles themselves, not who held them."
          busy={busy}
          onCopy={(fromEventId) =>
            run(() => api.copyLeadRoles(ready.eventId, fromEventId), 'Could not copy those roles.')
          }
        />
      )}

      {ready !== undefined && ready.roles.length > 0 && (
        <div class="lead-table-wrap">
          <table class="lead-table">
            <thead>
              <tr>
                {HEADINGS.map((heading) => (
                  <th key={heading} scope="col">
                    {heading}
                  </th>
                ))}
                <th scope="col">
                  <span class="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {ready.roles.map((role) =>
                editing === role.id ? (
                  <tr key={role.id}>
                    <td colSpan={HEADINGS.length + 1}>
                      <RoleFields
                        role={role}
                        busy={busy}
                        onCancel={() => setEditing(undefined)}
                        onSave={(changes) =>
                          run(async () => {
                            await api.updateLeadRole(role.id, changes)
                            setEditing(undefined)
                          }, 'Could not save that.')
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  <RoleRow
                    key={role.id}
                    role={role}
                    attendees={ready.attendees}
                    viewerId={viewer.account?.id}
                    busy={busy}
                    onEdit={() => setEditing(role.id)}
                    onRemove={() => run(() => api.deleteLeadRole(role.id), 'Could not remove that role.')}
                    onLead={(accountId) =>
                      run(() => api.setLeadRoleLead(role.id, accountId), 'Could not change the lead.')
                    }
                    onJoin={(accountId) =>
                      run(() => api.joinLeadRoleTeam(role.id, accountId), 'Could not add them to the team.')
                    }
                    onLeave={(accountId) =>
                      run(
                        () => api.leaveLeadRoleTeam(role.id, accountId),
                        'Could not take them off the team.',
                      )
                    }
                  />
                ),
              )}
            </tbody>
          </table>
        </div>
      )}

      {ready !== undefined && (
        <AddRole
          title={title}
          busy={busy}
          onTitle={setTitle}
          onAdd={() => {
            if (title.trim() === '') {
              setError('Give the role a name.')
              return
            }

            run(async () => {
              await api.addLeadRole(ready.eventId, { title: title.trim() })
              setTitle('')
            }, 'Could not add that role.')
          }}
        />
      )}
    </GuardedPage>
  )
}

const Notice = ({ loaded }: { loaded: Loaded<Register> }) => {
  if (loaded.status === 'loading') return <p class="form-note">Loading…</p>
  if (loaded.status === 'failed') {
    return (
      <p class="form-error" role="alert">
        {loaded.message}
      </p>
    )
  }
  if (loaded.data === null) {
    return <NoBurn absent="there is nothing to look after" />
  }

  return loaded.data.roles.length === 0 ? (
    <p class="form-note">No roles yet. Add the first one below.</p>
  ) : null
}

const AddRole = ({
  title,
  busy,
  onTitle,
  onAdd,
}: {
  title: string
  busy: boolean
  onTitle: (value: string) => void
  onAdd: () => void
}) => (
  <form
    class="form"
    onSubmit={(submitEvent) => {
      submitEvent.preventDefault()
      onAdd()
    }}
  >
    <h2>Add a role</h2>

    <label class="field">
      <span>What needs looking after?</span>
      <input
        type="text"
        name="title"
        maxLength={MAX_TITLE}
        aria-required
        value={title}
        onInput={(inputEvent) => onTitle(inputEvent.currentTarget.value)}
      />
    </label>

    <button type="submit" disabled={busy}>
      Add it
    </button>
  </form>
)

/** Markdown a member wrote, or an em dash so an empty cell is deliberate. */
const Prose = ({ markdown }: { markdown: string }) =>
  markdown.trim() === '' ? (
    <span class="form-note">—</span>
  ) : (
    // Safe by construction: `renderMarkdown` escapes raw HTML rather than filtering it.
    <div class="markdown-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }} />
  )

const RoleRow = ({
  role,
  attendees,
  viewerId,
  busy,
  onEdit,
  onRemove,
  onLead,
  onJoin,
  onLeave,
}: {
  role: LeadRole
  attendees: readonly Person[]
  viewerId: string | undefined
  busy: boolean
  onEdit: () => void
  onRemove: () => void
  onLead: (accountId: string | null) => void
  onJoin: (accountId: string) => void
  onLeave: (accountId: string) => void
}) => {
  const [confirming, setConfirming] = useState(false)
  return (
    <tr>
      <th scope="row">{role.title}</th>

      <td data-label={COLUMNS.purpose}>
        <Prose markdown={role.purpose} />
      </td>

      <td data-label={COLUMNS.lead}>
        <select
          aria-label={`Lead of ${role.title}`}
          disabled={busy}
          value={role.lead?.account_id ?? ''}
          onChange={(changeEvent) => onLead(changeEvent.currentTarget.value || null)}
        >
          <option value="">Nobody yet</option>
          {attendees.map((person) => (
            <option key={person.account_id} value={person.account_id}>
              {nameOf(person)}
            </option>
          ))}
        </select>
      </td>

      <td data-label={COLUMNS.tasks}>
        <Prose markdown={role.tasks} />
      </td>

      <td data-label={COLUMNS.team}>
        <HelperStrip
          label={role.title}
          people={role.team}
          wanted={role.team_size_wanted}
          candidates={attendees}
          viewerId={viewerId}
          busy={busy}
          onAdd={onJoin}
          onRemove={onLeave}
        />
      </td>

      <td data-label={COLUMNS.before}>{EFFORT_LABEL[role.effort_before]}</td>
      <td data-label={COLUMNS.during}>{EFFORT_LABEL[role.effort_during]}</td>
      <td data-label={COLUMNS.after}>{EFFORT_LABEL[role.effort_after]}</td>

      <td data-label="Actions" class="lead-actions">
        <button
          type="button"
          class="link-button"
          disabled={busy}
          aria-label={`Edit ${role.title}`}
          onClick={onEdit}
        >
          ✏️
        </button>

        {confirming ? (
          <>
            <span class="form-note">Remove {role.title} and everyone on it?</span>
            <button
              type="button"
              disabled={busy}
              aria-label={`Really remove ${role.title}`}
              onClick={onRemove}
            >
              Remove it
            </button>
            <button type="button" class="link-button" disabled={busy} onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </>
        ) : (
          <button
            type="button"
            class="link-button"
            disabled={busy}
            aria-label={`Remove ${role.title}`}
            onClick={() => setConfirming(true)}
          >
            🗑️
          </button>
        )}
      </td>
    </tr>
  )
}

const RoleFields = ({
  role,
  busy,
  onSave,
  onCancel,
}: {
  role: LeadRole
  busy: boolean
  onSave: (changes: LeadRoleUpdate) => void
  onCancel: () => void
}) => {
  const [title, setTitle] = useState(role.title)
  const [purpose, setPurpose] = useState(role.purpose)
  const [tasks, setTasks] = useState(role.tasks)
  const [before, setBefore] = useState<EffortLevel>(role.effort_before)
  const [during, setDuring] = useState<EffortLevel>(role.effort_during)
  const [after, setAfter] = useState<EffortLevel>(role.effort_after)
  const [wanted, setWanted] = useState(String(role.team_size_wanted))

  // Only the fields this form changed. Sending all seven would carry the values it
  // loaded at mount, so fixing a typo in the title would put back whatever somebody
  // else edited meanwhile — the ordinary case on a page several people share.
  const edits = (): LeadRoleUpdate => ({
    ...(title.trim() === role.title ? {} : { title: title.trim() }),
    ...(purpose === role.purpose ? {} : { purpose }),
    ...(tasks === role.tasks ? {} : { tasks }),
    ...(before === role.effort_before ? {} : { effort_before: before }),
    ...(during === role.effort_during ? {} : { effort_during: during }),
    ...(after === role.effort_after ? {} : { effort_after: after }),
    // An emptied number input is "I will fill this in later", not zero. `Number('')`
    // is 0, so sending it saved "nobody wanted" — and the page then rendered that as
    // "none asked for", which reads as a decision somebody made.
    ...(wanted.trim() === '' || wanted === String(role.team_size_wanted)
      ? {}
      : { team_size_wanted: Number(wanted) }),
  })

  return (
    <div class="role-edit">
      <label class="field">
        <span>What needs looking after?</span>
        <input
          type="text"
          maxLength={MAX_TITLE}
          aria-label={`Title of ${role.title}`}
          value={title}
          onInput={(inputEvent) => setTitle(inputEvent.currentTarget.value)}
        />
      </label>

      <MarkdownField
        label={`Purpose of ${role.title}`}
        value={purpose}
        maxLength={MAX_NOTES}
        onInput={setPurpose}
      />

      <MarkdownField
        label={`Tasks of ${role.title}`}
        value={tasks}
        maxLength={MAX_NOTES}
        onInput={setTasks}
      />

      <EffortField label={`Effort before ${role.title}`} value={before} onChange={setBefore} />
      <EffortField label={`Effort during ${role.title}`} value={during} onChange={setDuring} />
      <EffortField label={`Effort after ${role.title}`} value={after} onChange={setAfter} />

      <label class="field">
        <span>People wanted besides the lead</span>
        <input
          type="number"
          min={0}
          step={1}
          aria-label={`Team wanted for ${role.title}`}
          value={wanted}
          onInput={(inputEvent) => setWanted(inputEvent.currentTarget.value)}
        />
      </label>

      <button type="button" disabled={busy} onClick={() => onSave(edits())}>
        Save
      </button>
      <button type="button" class="link-button" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}

const EffortField = ({
  label,
  value,
  onChange,
}: {
  label: string
  value: EffortLevel
  onChange: (value: EffortLevel) => void
}) => (
  <label class="field">
    <span>{label}</span>
    <select
      aria-label={label}
      value={value}
      onChange={(changeEvent) => {
        const chosen = changeEvent.currentTarget.value
        // The `<option>`s come from `effortLevels`, so this narrows rather than
        // validates — but a `select`'s value is a plain string, and the alternative
        // is a cast.
        const found = effortLevels.find((level) => level === chosen)
        if (found !== undefined) onChange(found)
      }}
    >
      {effortLevels.map((level) => (
        <option key={level} value={level}>
          {EFFORT_LABEL[level]}
        </option>
      ))}
    </select>
  </label>
)
