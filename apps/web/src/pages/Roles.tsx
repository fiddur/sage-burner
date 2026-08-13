import type { EffortLevel, EventAttendeesResponse, LeadRole, LeadRoleUpdate } from '@sage-burner/shared'

import { effortLevels, MAX_NOTES, MAX_TITLE } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { CopySource } from '../components/CopyFrom.tsx'
import type { UploadImage } from '../image-upload.ts'
import type { Loaded } from '../load.ts'

import { useSelectedBurn } from '../burn.tsx'
import { CopyFrom } from '../components/CopyFrom.tsx'
import { Destroy } from '../components/Destroy.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { HelperStrip } from '../components/HelperStrip.tsx'
import { IconButton } from '../components/IconButton.tsx'
import { MarkdownField } from '../components/MarkdownField.tsx'
import { NoBurn } from '../components/NoBurn.tsx'
import { Refreshing } from '../components/Refreshing.tsx'
import { stillUploading } from '../image-upload.ts'
import { joinFirst, joinLink } from '../joining.ts'
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
  | 'uploadImage'
>

type Person = EventAttendeesResponse['attendees'][number]

type Register = {
  eventId: string
  roles: readonly LeadRole[]
  attendees: readonly Person[]
  sources: readonly CopySource[]
} | null

const EFFORT_LABEL: Record<EffortLevel, string> = {
  none: 'none',
  low: 'a little',
  medium: 'some',
  high: 'a lot',
}

const segmentsFor = (level: EffortLevel): number => effortLevels.indexOf(level)

const SEGMENTS = effortLevels.slice(1).map((_level, index) => index)

const PHASES = [
  { key: 'before', icon: '🌱', label: 'before' },
  { key: 'during', icon: '🔥', label: 'during' },
  { key: 'after', icon: '🧹', label: 'after' },
] as const

const HEADINGS = ['Title', 'Purpose', 'Who', 'Tasks include', 'Effort'] as const

const WHO = { lead: 'Lead', team: 'Team' } as const

const EFFORT_LEGEND = PHASES.map((phase) => `${phase.icon} ${phase.label}`).join(' · ')

const Effort = ({ role }: { role: LeadRole }) => (
  <span class="effort-strip">
    {PHASES.map((phase) => {
      const level = role[`effort_${phase.key}`]
      const said = `Effort ${phase.label}: ${EFFORT_LABEL[level]}`

      return (
        <span class="effort" key={phase.key} title={said}>
          <span aria-hidden="true">{phase.icon}</span>
          <span class="effort-bar" aria-hidden="true">
            {SEGMENTS.map((segment) => (
              <span key={segment} class={segment < segmentsFor(level) ? 'is-on' : undefined} />
            ))}
          </span>
          <span class="visually-hidden">{said}</span>
        </span>
      )
    })}
  </span>
)

export const Roles = ({ api }: { api: RolesApi }) => {
  const viewer = useViewer()
  const approved = isApproved(viewer)
  const [title, setTitle] = useState('')
  const [editing, setEditing] = useState<string | undefined>(undefined)

  const burn = useSelectedBurn()
  const { loaded, refreshing, reload } = useLoad<Register>(
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
    {
      enabled: approved,
      key: burn?.event.id ?? '',
      fallback: 'Could not load the roles.',
      live: true,
      remember: 'roles',
    },
  )

  const { busy, error, setError, run } = useAction(reload)

  const ready = loaded.status === 'ready' ? (loaded.data ?? undefined) : undefined

  return (
    <GuardedPage title="Leads" require="approved">
      <h1>
        Leads <Refreshing on={refreshing} />
      </h1>

      <p class="form-note">
        Who is looking after what. Anyone can add a role, take one on, or put somebody else's name to one —
        and anyone can change or remove one, so talk to each other first.
      </p>

      <ErrorText message={error} link={joinLink(error)} />

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
        <>
          <p class="form-note lead-effort-legend">Effort: {EFFORT_LEGEND}</p>
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
                          upload={api.uploadImage}
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
                        run(
                          () => api.setLeadRoleLead(role.id, accountId),
                          joinFirst(
                            'Could not change the lead.',
                            accountId === viewer.account?.id ? 'mine' : 'theirs',
                          ),
                        )
                      }
                      onJoin={(accountId) =>
                        run(
                          () => api.joinLeadRoleTeam(role.id, accountId),
                          joinFirst(
                            'Could not add them to the team.',
                            accountId === viewer.account?.id ? 'mine' : 'theirs',
                          ),
                        )
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
        </>
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
    return <ErrorText message={loaded.message} />
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

const Prose = ({ markdown }: { markdown: string }) =>
  markdown.trim() === '' ? (
    <span class="form-note">—</span>
  ) : (
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
  return (
    <tr>
      <th scope="row">{role.title}</th>

      <td>
        <Prose markdown={role.purpose} />
      </td>

      <td>
        <div class="lead-who">
          <div class="lead-who-part">
            <p class="lead-who-label">{WHO.lead}</p>
            <HelperStrip
              label={`${role.title} lead`}
              people={role.lead === null ? [] : [role.lead]}
              max={1}
              candidates={attendees}
              everyone={attendees}
              viewerId={viewerId}
              busy={busy}
              onAdd={(accountId) => onLead(accountId)}
              onRemove={() => onLead(null)}
            />
          </div>

          <div class="lead-who-part">
            <p class="lead-who-label">{WHO.team}</p>
            <HelperStrip
              label={role.title}
              people={role.team}
              wanted={role.team_size_wanted}
              candidates={attendees}
              everyone={attendees}
              viewerId={viewerId}
              busy={busy}
              onAdd={onJoin}
              onRemove={onLeave}
            />
          </div>
        </div>
      </td>

      <td>
        <Prose markdown={role.tasks} />
      </td>

      <td>
        <Effort role={role} />
      </td>

      <td class="lead-actions">
        <IconButton icon="✏️" label={`Edit ${role.title}`} disabled={busy} onClick={onEdit} />

        <Destroy what={role.title} because="Everyone on it goes too." busy={busy} onDestroy={onRemove} />
      </td>
    </tr>
  )
}

const RoleFields = ({
  role,
  busy,
  upload,
  onSave,
  onCancel,
}: {
  role: LeadRole
  busy: boolean
  upload: UploadImage
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

  const edits = (): LeadRoleUpdate => ({
    ...(title.trim() === role.title ? {} : { title: title.trim() }),
    ...(purpose === role.purpose ? {} : { purpose }),
    ...(tasks === role.tasks ? {} : { tasks }),
    ...(before === role.effort_before ? {} : { effort_before: before }),
    ...(during === role.effort_during ? {} : { effort_during: during }),
    ...(after === role.effort_after ? {} : { effort_after: after }),
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
        upload={upload}
        onInput={setPurpose}
      />

      <MarkdownField
        label={`Tasks of ${role.title}`}
        value={tasks}
        maxLength={MAX_NOTES}
        upload={upload}
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

      <button
        type="button"
        disabled={busy || stillUploading(purpose) || stillUploading(tasks)}
        onClick={() => onSave(edits())}
      >
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
