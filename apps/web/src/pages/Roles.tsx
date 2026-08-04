import type { CopySourcesResponse, EffortLevel, LeadRole, LeadRoleUpdate } from '@sage-burner/shared'

import { effortLevels, MAX_NOTES, MAX_TITLE } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { Loaded } from '../load.ts'

import { CopyFrom } from '../components/CopyFrom.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { MarkdownField } from '../components/MarkdownField.tsx'
import { useAction, useLoad } from '../load.ts'
import { renderMarkdown } from '../markdown.ts'
import { isApproved, useViewer } from '../viewer.tsx'

export type RolesApi = Pick<
  ApiClient,
  | 'getActiveEvent'
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

const teamCount = (role: LeadRole) =>
  role.team_size_wanted === 0
    ? `${role.team.length} on the team, none asked for`
    : `${role.team.length} of ${role.team_size_wanted} wanted`

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

  const { loaded, reload } = useLoad<Register>(
    async (signal) => {
      const active = await api.getActiveEvent(signal)
      if (active.event === null) return null

      const eventId = active.event.id
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
    { enabled: approved, fallback: 'Could not load the roles.' },
  )

  const { busy, error, setError, run } = useAction(reload)

  const ready = loaded.status === 'ready' ? (loaded.data ?? undefined) : undefined

  return (
    <GuardedPage title="Roles" require="approved">
      <h1>Roles</h1>

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
          busy={busy}
          onCopy={(fromEventId) =>
            run(() => api.copyLeadRoles(ready.eventId, fromEventId), 'Could not copy those roles.')
          }
        />
      )}

      <ol class="role-list">
        {(ready?.roles ?? []).map((role) => (
          <li key={role.id}>
            {editing === role.id ? (
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
            ) : (
              <RoleCard
                role={role}
                attendees={ready?.attendees ?? []}
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
                  run(() => api.leaveLeadRoleTeam(role.id, accountId), 'Could not take them off the team.')
                }
              />
            )}
          </li>
        ))}
      </ol>

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
    return <p class="form-note">There is no burn coming up yet, so there is nothing to look after.</p>
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

const RoleCard = ({
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
  const onTeam = new Set(role.team.map((person) => person.account_id))
  const canJoin = viewerId !== undefined && attendees.some((person) => person.account_id === viewerId)

  return (
    <div class="role-card">
      <h3>{role.title}</h3>

      <p class="role-lead">
        {role.lead === null ? 'Nobody has taken this on yet.' : `Led by ${nameOf(role.lead)}`}
      </p>

      {role.purpose.trim() !== '' && (
        // Safe by construction: `renderMarkdown` escapes raw HTML rather than
        // filtering it, which is why a member may author this. `markdown.ts` says why.
        <div class="markdown-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(role.purpose) }} />
      )}

      {role.tasks.trim() !== '' && (
        <details>
          <summary>Tasks include</summary>
          <div class="markdown-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(role.tasks) }} />
        </details>
      )}

      <p class="role-effort">
        Effort: {EFFORT_LABEL[role.effort_before]} before, {EFFORT_LABEL[role.effort_during]} during,{' '}
        {EFFORT_LABEL[role.effort_after]} after
      </p>

      <label class="field">
        <span>Lead</span>
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
      </label>

      <p class="role-team-count">{teamCount(role)}</p>

      <ul class="role-team">
        {role.team.map((person) => (
          <li key={person.account_id}>
            {nameOf(person)}
            <button
              type="button"
              class="link-button"
              disabled={busy}
              aria-label={`Take ${nameOf(person)} off ${role.title}`}
              onClick={() => onLeave(person.account_id)}
            >
              🗑️
            </button>
          </li>
        ))}
      </ul>

      {canJoin && !onTeam.has(viewerId) && role.lead?.account_id !== viewerId && (
        <button type="button" disabled={busy} onClick={() => onJoin(viewerId)}>
          Join the team
        </button>
      )}

      <AddToTeam
        role={role}
        attendees={attendees.filter(
          (person) => !onTeam.has(person.account_id) && person.account_id !== viewerId,
        )}
        busy={busy}
        onJoin={onJoin}
      />

      <button type="button" class="link-button" disabled={busy} onClick={onEdit}>
        Edit
      </button>

      {confirming ? (
        <>
          <span class="form-note">Remove {role.title} and everyone on it?</span>
          <button type="button" disabled={busy} aria-label={`Really remove ${role.title}`} onClick={onRemove}>
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
    </div>
  )
}

const AddToTeam = ({
  role,
  attendees,
  busy,
  onJoin,
}: {
  role: LeadRole
  attendees: readonly Person[]
  busy: boolean
  onJoin: (accountId: string) => void
}) => {
  const [chosen, setChosen] = useState('')

  if (attendees.length === 0) return null

  return (
    <div>
      <label class="field">
        <span>Put somebody on it</span>
        <select
          aria-label={`Add somebody to ${role.title}`}
          disabled={busy}
          value={chosen}
          onChange={(changeEvent) => setChosen(changeEvent.currentTarget.value)}
        >
          <option value="">Choose somebody</option>
          {attendees.map((person) => (
            <option key={person.account_id} value={person.account_id}>
              {nameOf(person)}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        disabled={busy || chosen === ''}
        onClick={() => {
          onJoin(chosen)
          setChosen('')
        }}
      >
        Add them
      </button>
    </div>
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
