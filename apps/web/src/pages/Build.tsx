import type {
  BuildItem,
  BuildItemUpdate,
  BuildPriority,
  BuildProject,
  BuildProjectUpdate,
  BuildTier,
  EventAttendeesResponse,
} from '@sage-burner/shared'

import {
  BUILD_PARAM,
  buildPriorities,
  buildPriorityLabel,
  buildTierLabel,
  buildTiers,
  MAX_NOTES,
  MAX_TITLE,
} from '@sage-burner/shared'
import { useLocation } from 'preact-iso'
import { useEffect, useRef, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { DreamTalk } from '../components/OpenedDream.tsx'
import type { UploadImage } from '../image-upload.ts'
import type { Loaded } from '../load.ts'

import { useSelectedBurn } from '../burn.tsx'
import { Destroy } from '../components/Destroy.tsx'
import { DreamThread } from '../components/DreamThread.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { Heart } from '../components/Heart.tsx'
import { HelperStrip } from '../components/HelperStrip.tsx'
import { IconButton } from '../components/IconButton.tsx'
import { MarkdownField } from '../components/MarkdownField.tsx'
import { NoBurn } from '../components/NoBurn.tsx'
import { useDreamThread } from '../components/OpenedDream.tsx'
import { Refreshing } from '../components/Refreshing.tsx'
import { ReorderableList } from '../components/ReorderableList.tsx'
import { TheirVersion } from '../components/TheirVersion.tsx'
import { stillUploading } from '../image-upload.ts'
import { joinFirst, joinLink } from '../joining.ts'
import { useAction, useLoad } from '../load.ts'
import { renderMarkdown } from '../markdown.ts'
import { isAdmin, isApproved, useViewer } from '../viewer.tsx'
import { recentlyGone } from './Songs.tsx'

export type BuildApi = Pick<
  ApiClient,
  | 'getBuildProjects'
  | 'addBuildProject'
  | 'updateBuildProject'
  | 'reorderBuildProjects'
  | 'deleteBuildProject'
  | 'restoreBuildProject'
  | 'setBuildLead'
  | 'addBuildHelper'
  | 'removeBuildHelper'
  | 'addBuildItem'
  | 'updateBuildItem'
  | 'deleteBuildItem'
  | 'getEventAttendees'
  | 'supportThread'
  | 'withdrawSupportForThread'
  | 'getThread'
  | 'postComment'
  | 'updateComment'
  | 'deleteComment'
  | 'supportComment'
  | 'withdrawSupportForComment'
  | 'uploadImage'
>

type Attendee = EventAttendeesResponse['attendees'][number]

type Plan = {
  eventId: string
  projects: readonly BuildProject[]
  attendees: readonly Attendee[]
} | null

const tierFrom = (value: string): BuildTier | undefined => buildTiers.find((tier) => tier === value)

const priorityFrom = (value: string): BuildPriority | undefined =>
  buildPriorities.find((priority) => priority === value)

export const Build = ({ api }: { api: BuildApi }) => {
  const viewer = useViewer()
  const approved = isApproved(viewer)
  const viewerId = viewer.account?.id
  const burn = useSelectedBurn()
  const [opened, setOpened] = useState<string | undefined>(undefined)
  const [editing, setEditing] = useState<string | undefined>(undefined)
  const [title, setTitle] = useState('')
  const [tier, setTier] = useState<BuildTier>('reality')

  const { loaded, refreshing, reload } = useLoad<Plan>(
    async (signal) => {
      if (burn === undefined) return null

      const eventId = burn.event.id
      const [plan, coming] = await Promise.all([
        api.getBuildProjects(eventId, signal),
        api.getEventAttendees(eventId, signal),
      ])

      return { eventId, projects: plan.projects, attendees: coming.attendees }
    },
    {
      enabled: approved,
      key: burn?.event.id ?? '',
      fallback: 'Could not load the build plan.',
      live: true,
      remember: 'build',
    },
  )

  const { busy, error, failure, setError, run } = useAction(reload)

  const ready = loaded.status === 'ready' ? (loaded.data ?? undefined) : undefined
  const projects = ready?.projects ?? []
  const attendees = ready?.attendees ?? []
  const live = projects.filter((project) => project.withdrawn_at === null)
  const gone = projects.filter((project) => recentlyGone(project.withdrawn_at, Date.now()))

  const asked: string | undefined = useLocation().query?.[BUILD_PARAM]

  useEffect(() => {
    if (asked !== undefined) setOpened(asked)
  }, [asked])

  const talk = useDreamThread({
    api,
    threadId: live.find((project) => project.id === opened)?.thread_id,
    run,
  })

  const add = () => {
    if (ready === undefined) return
    if (title.trim() === '') {
      setError('Say what is being built.')
      return
    }

    run(async () => {
      await api.addBuildProject(ready.eventId, { title: title.trim(), tier })
      setTitle('')
    }, 'Could not add that project.')
  }

  const whose = (accountId: string) => (accountId === viewerId ? 'mine' : 'theirs')

  return (
    <GuardedPage title="Build" require="approved">
      <h1>
        Build <Refreshing on={refreshing} />
      </h1>

      <p class="form-note">
        What gets built on site, and what it takes. Anyone can add a project, lead it, help with it or tick
        off its checklist — and anyone can change or take one off, so talk to each other first.
      </p>

      <ErrorText message={error} link={joinLink(error)} />

      <Notice loaded={loaded} />

      {ready !== undefined &&
        buildTiers.map((shown) => {
          const rows = live.filter((project) => project.tier === shown)

          return (
            <section key={shown}>
              <h2>{buildTierLabel[shown]}</h2>
              {rows.length === 0 ? (
                <p class="form-note">Nothing here yet.</p>
              ) : (
                <ReorderableList
                  rows={rows}
                  busy={busy}
                  rowClass="build-row"
                  labelFor={(project) => project.title}
                  onReorder={(ids) =>
                    run(
                      () => api.reorderBuildProjects(ready.eventId, { tier: shown, ids }),
                      'Could not move that.',
                    )
                  }
                >
                  {(project) => (
                    <ProjectCard
                      project={project}
                      attendees={attendees}
                      viewerId={viewerId}
                      admin={isAdmin(viewer)}
                      busy={busy}
                      asked={asked === project.id}
                      opened={opened === project.id}
                      editing={editing === project.id}
                      talk={talk}
                      failure={failure}
                      upload={api.uploadImage}
                      onOpen={() => setOpened(opened === project.id ? undefined : project.id)}
                      onEdit={(wanted) => setEditing(wanted ? project.id : undefined)}
                      onSave={(changes) =>
                        run(async () => {
                          await api.updateBuildProject(project.id, changes)
                          setEditing(undefined)
                        }, 'Could not save that.')
                      }
                      onWithdraw={() =>
                        run(() => api.deleteBuildProject(project.id), 'Could not take that off.')
                      }
                      onHeart={(hearting) => {
                        const threadId = project.thread_id
                        if (threadId === null) return

                        run(
                          () =>
                            hearting ? api.supportThread(threadId) : api.withdrawSupportForThread(threadId),
                          'Could not save that.',
                        )
                      }}
                      onLead={(accountId) =>
                        run(
                          () => api.setBuildLead(project.id, accountId),
                          joinFirst(
                            'Could not change the lead.',
                            accountId === null ? 'mine' : whose(accountId),
                          ),
                        )
                      }
                      onHelper={(helping, accountId) =>
                        run(
                          () =>
                            helping
                              ? api.addBuildHelper(project.id, accountId)
                              : api.removeBuildHelper(project.id, accountId),
                          joinFirst('Could not save that.', whose(accountId)),
                        )
                      }
                      onAddItem={(text, priority, added) =>
                        run(async () => {
                          await api.addBuildItem(project.id, { text, priority })
                          added()
                        }, 'Could not add that.')
                      }
                      onChangeItem={(itemId, changes, saved) =>
                        run(async () => {
                          await api.updateBuildItem(itemId, changes)
                          saved?.()
                        }, 'Could not save that.')
                      }
                      onRemoveItem={(itemId) =>
                        run(() => api.deleteBuildItem(itemId), 'Could not remove that.')
                      }
                    />
                  )}
                </ReorderableList>
              )}
            </section>
          )
        })}

      {ready !== undefined && (
        <form
          class="form"
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault()
            add()
          }}
        >
          <h2>Add a project</h2>

          <label class="field">
            <span>What is being built?</span>
            <input
              type="text"
              name="title"
              maxLength={MAX_TITLE}
              aria-required
              value={title}
              onInput={(inputEvent) => setTitle(inputEvent.currentTarget.value)}
            />
          </label>

          <TierField label="Under" value={tier} onChange={setTier} />

          <button type="submit" disabled={busy}>
            Add it
          </button>
        </form>
      )}

      {gone.length > 0 && (
        <section>
          <h2>Recently taken off</h2>
          <p class="form-note">
            Anybody can take a project off and anybody can bring it back, with its checklist, its people and
            its conversation still on it.
          </p>
          <ul class="dream-list">
            {gone.map((project) => (
              <li key={project.id} class="dream-row is-gone">
                <span class="dream-title">{project.title}</span>
                <IconButton
                  icon="restore"
                  label={`Bring ${project.title} back`}
                  disabled={busy}
                  onClick={() => run(() => api.restoreBuildProject(project.id), 'Could not bring that back.')}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </GuardedPage>
  )
}

const Notice = ({ loaded }: { loaded: Loaded<Plan> }) => {
  if (loaded.status === 'loading') return <p class="form-note">Loading…</p>
  if (loaded.status === 'failed') return <ErrorText message={loaded.message} />
  if (loaded.data === null) return <NoBurn absent="there is nothing to build" />

  return null
}

const TierField = ({
  label,
  value,
  onChange,
}: {
  label: string
  value: BuildTier
  onChange: (tier: BuildTier) => void
}) => (
  <label class="field">
    <span>{label}</span>
    <select
      value={value}
      onChange={(changeEvent) => {
        const chosen = tierFrom(changeEvent.currentTarget.value)
        if (chosen !== undefined) onChange(chosen)
      }}
    >
      {buildTiers.map((tier) => (
        <option key={tier} value={tier}>
          {buildTierLabel[tier]}
        </option>
      ))}
    </select>
  </label>
)

const PrioritySelect = ({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: BuildPriority
  disabled: boolean
  onChange: (priority: BuildPriority) => void
}) => (
  <select
    aria-label={label}
    value={value}
    disabled={disabled}
    onChange={(changeEvent) => {
      const chosen = priorityFrom(changeEvent.currentTarget.value)
      if (chosen !== undefined) onChange(chosen)
    }}
  >
    {buildPriorities.map((priority) => (
      <option key={priority} value={priority}>
        {buildPriorityLabel[priority]}
      </option>
    ))}
  </select>
)

const ProjectCard = ({
  project,
  attendees,
  viewerId,
  admin,
  busy,
  asked,
  opened,
  editing,
  talk,
  failure,
  upload,
  onOpen,
  onEdit,
  onSave,
  onWithdraw,
  onHeart,
  onLead,
  onHelper,
  onAddItem,
  onChangeItem,
  onRemoveItem,
}: {
  project: BuildProject
  attendees: readonly Attendee[]
  viewerId: string | undefined
  admin: boolean
  busy: boolean
  asked: boolean
  opened: boolean
  editing: boolean
  talk: DreamTalk
  failure: unknown
  upload: UploadImage
  onOpen: () => void
  onEdit: (wanted: boolean) => void
  onSave: (changes: BuildProjectUpdate) => void
  onWithdraw: () => void
  onHeart: (hearting: boolean) => void
  onLead: (accountId: string | null) => void
  onHelper: (helping: boolean, accountId: string) => void
  onAddItem: (text: string, priority: BuildPriority, added: () => void) => void
  onChangeItem: (itemId: string, changes: BuildItemUpdate, saved?: () => void) => void
  onRemoveItem: (itemId: string) => void
}) => {
  const self = useRef<HTMLElement>(null)

  useEffect(() => {
    if (asked) self.current?.scrollIntoView?.({ block: 'start' })
  }, [asked])

  return (
    <article class="build-project" ref={self}>
      <div class="build-head">
        <h3>{project.title}</h3>
        {project.thread_id !== null && (
          <Heart
            what={project.title}
            hearted={project.supported_by_me}
            count={project.support_count}
            people={project.supporters}
            busy={busy}
            onHeart={onHeart}
          />
        )}
      </div>

      {editing ? (
        <ProjectFields
          project={project}
          busy={busy}
          failure={failure}
          upload={upload}
          people={attendees}
          onCancel={() => onEdit(false)}
          onSave={onSave}
        />
      ) : (
        project.description.trim() !== '' && (
          <div
            class="markdown-preview"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(project.description) }}
          />
        )
      )}

      <div class="lead-who">
        <div class="lead-who-part">
          <p class="lead-who-label">Lead</p>
          <HelperStrip
            label={`${project.title} lead`}
            people={project.lead === null ? [] : [project.lead]}
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
          <p class="lead-who-label">Helpers</p>
          <HelperStrip
            label={`helping with ${project.title}`}
            people={project.helpers}
            candidates={attendees}
            everyone={attendees}
            viewerId={viewerId}
            busy={busy}
            onAdd={(accountId) => onHelper(true, accountId)}
            onRemove={(accountId) => onHelper(false, accountId)}
          />
        </div>
      </div>

      <Checklist
        project={project}
        busy={busy}
        onAdd={onAddItem}
        onChange={onChangeItem}
        onRemove={onRemoveItem}
      />

      <p class="bring-actions">
        <IconButton
          icon="comment"
          label={`${opened ? 'Hide' : 'Show'} what has been said about ${project.title}`}
          disabled={busy}
          onClick={onOpen}
        />
        <IconButton
          icon="edit"
          label={`Edit ${project.title}`}
          disabled={busy}
          onClick={() => onEdit(true)}
        />
        <Destroy
          what={project.title}
          verb="Take off"
          because="Anybody can bring it back, with its checklist and conversation."
          busy={busy}
          onDestroy={onWithdraw}
        />
      </p>

      {opened && (
        <DreamThread
          thread={talk.thread}
          viewerId={viewerId}
          admin={admin}
          busy={busy}
          more={false}
          upload={upload}
          people={attendees}
          onSay={talk.say}
          onRewrite={talk.rewrite}
          onRemove={talk.remove}
          onHeart={talk.heart}
        />
      )}
    </article>
  )
}

const ProjectFields = ({
  project,
  busy,
  failure,
  upload,
  people,
  onCancel,
  onSave,
}: {
  project: BuildProject
  busy: boolean
  failure: unknown
  upload: UploadImage
  people: readonly Attendee[]
  onCancel: () => void
  onSave: (changes: BuildProjectUpdate) => void
}) => {
  const [title, setTitle] = useState(project.title)
  const [description, setDescription] = useState(project.description)
  const [tier, setTier] = useState<BuildTier>(project.tier)

  const edits = (): BuildProjectUpdate => ({
    ...(title.trim() === project.title ? {} : { title: title.trim() }),
    ...(description === project.description ? {} : { description }),
    ...(tier === project.tier ? {} : { tier }),
  })

  return (
    <div class="bring-edit">
      <label class="field">
        <span>What is being built?</span>
        <input
          type="text"
          maxLength={MAX_TITLE}
          aria-label={`Title of ${project.title}`}
          value={title}
          onInput={(inputEvent) => setTitle(inputEvent.currentTarget.value)}
        />
      </label>

      <MarkdownField
        label="What is it, and how does it go together?"
        accessibleName={`Description of ${project.title}`}
        value={description}
        maxLength={MAX_NOTES}
        upload={upload}
        people={people}
        onInput={setDescription}
      />

      <TheirVersion failure={failure} at={['projects', project.id, 'description']} />

      <TierField label="Under" value={tier} onChange={setTier} />

      <p class="row">
        <button type="button" disabled={busy || stillUploading(description)} onClick={() => onSave(edits())}>
          Save
        </button>
        <button type="button" class="link-button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </p>
    </div>
  )
}

const Checklist = ({
  project,
  busy,
  onAdd,
  onChange,
  onRemove,
}: {
  project: BuildProject
  busy: boolean
  onAdd: (text: string, priority: BuildPriority, added: () => void) => void
  onChange: (itemId: string, changes: BuildItemUpdate, saved?: () => void) => void
  onRemove: (itemId: string) => void
}) => {
  const [text, setText] = useState('')
  const [priority, setPriority] = useState<BuildPriority>('needed')
  const [editing, setEditing] = useState<string | undefined>(undefined)

  return (
    <div class="build-checklist">
      {project.items.length > 0 && (
        <ul class="build-items">
          {project.items.map((item) =>
            editing === item.id ? (
              <li key={item.id} class="build-item">
                <ItemFields
                  item={item}
                  busy={busy}
                  onCancel={() => setEditing(undefined)}
                  onSave={(changes) => onChange(item.id, changes, () => setEditing(undefined))}
                />
              </li>
            ) : (
              <li key={item.id} class={item.done === null ? 'build-item' : 'build-item is-done'}>
                <span class={`build-priority is-${item.priority}`}>{buildPriorityLabel[item.priority]}</span>
                <label class="build-item-what">
                  <input
                    type="checkbox"
                    checked={item.done !== null}
                    disabled={busy}
                    onChange={(changeEvent) => onChange(item.id, { done: changeEvent.currentTarget.checked })}
                  />
                  <span>{item.text}</span>
                </label>
                {item.done !== null && <span class="form-note">{item.done.name ?? 'somebody'}</span>}
                <IconButton
                  icon="edit"
                  label={`Edit ${item.text}`}
                  disabled={busy}
                  onClick={() => setEditing(item.id)}
                />
                <Destroy what={item.text} busy={busy} onDestroy={() => onRemove(item.id)} />
              </li>
            ),
          )}
        </ul>
      )}

      <form
        class="build-item-add"
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault()
          if (text.trim() === '') return

          onAdd(text.trim(), priority, () => {
            setText('')
            setPriority('needed')
          })
        }}
      >
        <input
          type="text"
          maxLength={MAX_TITLE}
          aria-label={`Something ${project.title} needs`}
          placeholder="Something it needs"
          value={text}
          onInput={(inputEvent) => setText(inputEvent.currentTarget.value)}
        />
        <PrioritySelect
          label={`How much ${project.title} needs it`}
          value={priority}
          disabled={busy}
          onChange={setPriority}
        />
        <button type="submit" disabled={busy}>
          Add
        </button>
      </form>
    </div>
  )
}

const ItemFields = ({
  item,
  busy,
  onCancel,
  onSave,
}: {
  item: BuildItem
  busy: boolean
  onCancel: () => void
  onSave: (changes: { text?: string; priority?: BuildPriority }) => void
}) => {
  const [text, setText] = useState(item.text)
  const [priority, setPriority] = useState<BuildPriority>(item.priority)

  return (
    <span class="build-item-edit">
      <input
        type="text"
        maxLength={MAX_TITLE}
        aria-label={`Wording of ${item.text}`}
        value={text}
        onInput={(inputEvent) => setText(inputEvent.currentTarget.value)}
      />
      <PrioritySelect
        label={`How much it needs ${item.text}`}
        value={priority}
        disabled={busy}
        onChange={setPriority}
      />
      <button
        type="button"
        disabled={busy || text.trim() === ''}
        onClick={() =>
          onSave({
            ...(text.trim() === item.text ? {} : { text: text.trim() }),
            ...(priority === item.priority ? {} : { priority }),
          })
        }
      >
        Save
      </button>
      <button type="button" class="link-button" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
    </span>
  )
}
