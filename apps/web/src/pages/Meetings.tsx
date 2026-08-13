import type { Meeting, MeetingPointEntry } from '@sage-burner/shared'

import {
  MAX_DECIDED_NOTE,
  MAX_MEETING_LINK,
  MAX_NOTES,
  MAX_POST,
  MAX_TITLE,
  meetingEnds,
  nextMeeting,
  POINT_PARAM,
  profilePage,
} from '@sage-burner/shared'
import { useLocation } from 'preact-iso'
import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { DreamTalk } from '../components/OpenedDream.tsx'
import type { UploadImage } from '../image-upload.ts'

import { useSelectedBurn } from '../burn.tsx'
import { DreamThread } from '../components/DreamThread.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { IconButton } from '../components/IconButton.tsx'
import { MarkdownField } from '../components/MarkdownField.tsx'
import { NoBurn } from '../components/NoBurn.tsx'
import { useDreamThread } from '../components/OpenedDream.tsx'
import { PendingButton } from '../components/PendingButton.tsx'
import { Refreshing } from '../components/Refreshing.tsx'
import { fromLocalInput, localMoment, shortDayOf, toLocalInput } from '../datetime.ts'
import { useAction, useLoad } from '../load.ts'
import { renderMarkdown } from '../markdown.ts'
import { rowsFor } from '../textarea.ts'
import { isAdmin, isApproved, useViewer } from '../viewer.tsx'

export type MeetingsApi = Pick<
  ApiClient,
  | 'getMeetingPoints'
  | 'addMeetingPoint'
  | 'updateMeetingPoint'
  | 'deleteMeetingPoint'
  | 'decidePoint'
  | 'getMeetings'
  | 'addMeeting'
  | 'updateMeeting'
  | 'deleteMeeting'
  | 'getEventAttendees'
  | 'getThread'
  | 'postComment'
  | 'updateComment'
  | 'deleteComment'
  | 'uploadImage'
>

const BLANK = { title: '', body: '' }

interface MeetingDraft {
  title: string
  starts_at: string
  ends_at: string | null
  link: string | null
  notes: string
}

export const whenItIs = (meeting: Meeting, today: Date = new Date()): string => {
  const day = shortDayOf(meeting.starts_at)

  return day === undefined ? meeting.starts_at : `${day} ${localMoment(meeting.starts_at, today)}`
}

export const Meetings = ({ api }: { api: MeetingsApi }) => {
  const viewer = useViewer()
  const approved = isApproved(viewer)
  const burn = useSelectedBurn()
  const [draft, setDraft] = useState(BLANK)
  const [opened, setOpened] = useState<string | undefined>(undefined)
  const [scheduling, setScheduling] = useState(false)
  const [amending, setAmending] = useState(false)
  const [editing, setEditing] = useState<string | undefined>(undefined)

  const { loaded, refreshing, reload } = useLoad(
    async (signal) => {
      if (burn === undefined) return { points: [], meetings: [], attendees: [] }

      const [raised, diary, coming] = await Promise.all([
        api.getMeetingPoints(burn.event.id, signal),
        api.getMeetings(burn.event.id, signal),
        api.getEventAttendees(burn.event.id, signal),
      ])

      return { points: raised.points, meetings: diary.meetings, attendees: coming.attendees }
    },
    {
      enabled: approved,
      key: burn?.event.id ?? '',
      fallback: 'Could not load the meetings.',
      live: true,
      remember: 'meetings',
    },
  )

  const { busy, error, setError, run } = useAction(reload)

  const points = loaded.status === 'ready' ? loaded.data.points : []
  const meetings = loaded.status === 'ready' ? loaded.data.meetings : []
  const attendees = loaded.status === 'ready' ? loaded.data.attendees : []
  const viewerId = viewer.account?.id

  const asked: string | undefined = useLocation().query?.[POINT_PARAM]

  useEffect(() => {
    if (asked !== undefined) setOpened(asked)
  }, [asked])

  const talk = useDreamThread({
    api,
    threadId: points.find((point) => point.id === opened)?.thread_id,
    run,
  })

  const raise = () => {
    if (burn === undefined) return
    if (draft.title.trim() === '') {
      setError('Say what the point is, so somebody can answer it.')
      return
    }

    run(async () => {
      await api.addMeetingPoint(burn.event.id, { title: draft.title.trim(), body: draft.body.trim() })
      setDraft(BLANK)
    }, 'Could not raise that.')
  }

  const open = points.filter((point) => point.decision === null)
  const addressed = points.filter((point) => point.decision !== null)
  const now = new Date()
  const next = nextMeeting(meetings, now)
  const rest = meetings.filter((one) => one.id !== next?.id)
  const ahead = rest.filter((one) => Date.parse(meetingEnds(one.starts_at, one.ends_at)) > now.getTime())
  const over = rest.filter((one) => Date.parse(meetingEnds(one.starts_at, one.ends_at)) <= now.getTime())

  const list = (shown: readonly MeetingPointEntry[], empty: string) => (
    <PointList
      points={shown}
      empty={empty}
      viewerId={viewerId}
      admin={isAdmin(viewer)}
      busy={busy}
      opened={opened}
      editing={editing}
      talk={talk}
      upload={api.uploadImage}
      attendees={attendees}
      onOpen={(id) => setOpened(opened === id ? undefined : id)}
      onEdit={(id, wanted) => setEditing(wanted ? id : undefined)}
      onSave={(id, changes) =>
        run(async () => {
          await api.updateMeetingPoint(id, changes)
          setEditing(undefined)
        }, 'Could not save that.')
      }
      onDecide={(id, decision, decided_note) =>
        run(() => api.decidePoint(id, { decision, decided_note }), 'Could not record that.')
      }
      onRemove={(id) => run(() => api.deleteMeetingPoint(id), 'Could not take that off.')}
    />
  )

  return (
    <GuardedPage title="Meetings" require="approved">
      <h1>
        Meetings <Refreshing on={refreshing} />
      </h1>

      <p class="form-note">
        What we need to talk about, and when we are talking. Raise a point, discuss it in its thread or at the
        meeting, and record what was decided on the point itself.
      </p>

      <ErrorText message={error} />

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}
      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      {loaded.status === 'ready' && burn === undefined && <NoBurn absent="there is nothing to meet about" />}

      {loaded.status === 'ready' && burn !== undefined && (
        <>
          <NextMeeting
            next={next}
            busy={busy}
            scheduling={scheduling}
            editing={amending}
            onScheduling={setScheduling}
            onEditing={setAmending}
            onSchedule={(fields) =>
              run(async () => {
                await api.addMeeting(burn.event.id, fields)
                setScheduling(false)
              }, 'Could not put that in the diary.')
            }
            onSave={(id, fields) =>
              run(async () => {
                await api.updateMeeting(id, fields)
                setAmending(false)
              }, 'Could not save that.')
            }
            onDelete={(id) => run(() => api.deleteMeeting(id), 'Could not take that out.')}
          />

          <section>
            <h2>Open points</h2>
            {list(open, 'Nothing waiting to be talked about.')}
          </section>

          <section>
            <h2>Addressed</h2>
            {list(addressed, 'Nothing has been decided yet.')}
          </section>

          <RaiseAPoint
            draft={draft}
            busy={busy}
            upload={api.uploadImage}
            onDraft={setDraft}
            onRaise={raise}
          />

          <TheDiary
            heading="Also in the diary"
            meetings={ahead}
            busy={busy}
            onDelete={(id) => run(() => api.deleteMeeting(id), 'Could not take that out.')}
          />

          <TheDiary
            heading="Meetings that have been"
            meetings={over}
            busy={busy}
            onDelete={(id) => run(() => api.deleteMeeting(id), 'Could not take that out.')}
          />
        </>
      )}
    </GuardedPage>
  )
}

const TheDiary = ({
  heading,
  meetings,
  busy,
  onDelete,
}: {
  heading: string
  meetings: readonly Meeting[]
  busy: boolean
  onDelete: (id: string) => void
}) =>
  meetings.length === 0 ? null : (
    <section>
      <h2>{heading}</h2>
      <ul class="meeting-list">
        {meetings.map((one) => (
          <li key={one.id}>
            <strong>{one.title}</strong> — {whenItIs(one)}
            <IconButton
              icon="🗑️"
              label={`Take ${one.title} out of the diary`}
              disabled={busy}
              onClick={() => onDelete(one.id)}
            />
          </li>
        ))}
      </ul>
    </section>
  )

const PointList = ({
  points,
  empty,
  viewerId,
  admin,
  busy,
  opened,
  editing,
  talk,
  upload,
  attendees,
  onOpen,
  onEdit,
  onSave,
  onDecide,
  onRemove,
}: {
  points: readonly MeetingPointEntry[]
  empty: string
  viewerId: string | undefined
  admin: boolean
  busy: boolean
  opened: string | undefined
  editing: string | undefined
  talk: DreamTalk
  upload: UploadImage
  attendees: readonly { account_id: string; name: string | null }[]
  onOpen: (id: string) => void
  onEdit: (id: string, wanted: boolean) => void
  onSave: (id: string, changes: { title: string; body: string }) => void
  onDecide: (id: string, decision: string | null, decided_note: string | null) => void
  onRemove: (id: string) => void
}) =>
  points.length === 0 ? (
    <p class="form-note">{empty}</p>
  ) : (
    <ul class="point-list">
      {points.map((point) => (
        <Point
          key={point.id}
          point={point}
          viewerId={viewerId}
          admin={admin}
          busy={busy}
          opened={opened === point.id}
          editing={editing === point.id}
          talk={talk}
          upload={upload}
          attendees={attendees}
          onOpen={() => onOpen(point.id)}
          onEdit={(wanted) => onEdit(point.id, wanted)}
          onSave={(changes) => onSave(point.id, changes)}
          onDecide={(decision, note) => onDecide(point.id, decision, note)}
          onRemove={() => onRemove(point.id)}
        />
      ))}
    </ul>
  )

const RaiseAPoint = ({
  draft,
  busy,
  upload,
  onDraft,
  onRaise,
}: {
  draft: { title: string; body: string }
  busy: boolean
  upload: UploadImage
  onDraft: (next: { title: string; body: string }) => void
  onRaise: () => void
}) => (
  <form
    class="form"
    onSubmit={(submitEvent) => {
      submitEvent.preventDefault()
      onRaise()
    }}
  >
    <h2>Raise a point</h2>

    <label class="field">
      <span>What is it?</span>
      <input
        type="text"
        name="title"
        maxLength={MAX_TITLE}
        aria-required
        value={draft.title}
        onInput={(typed) => onDraft({ ...draft, title: typed.currentTarget.value })}
      />
    </label>

    <MarkdownField
      label="Anything else about it?"
      value={draft.body}
      maxLength={MAX_POST}
      upload={upload}
      onInput={(value) => onDraft({ ...draft, body: value })}
    />

    <PendingButton busy={busy} label="Raise it" busyLabel="Raising…" type="submit" />
  </form>
)

const NextMeeting = ({
  next,
  busy,
  scheduling,
  editing,
  onScheduling,
  onEditing,
  onSchedule,
  onSave,
  onDelete,
}: {
  next: Meeting | undefined
  busy: boolean
  scheduling: boolean
  editing: boolean
  onScheduling: (wanted: boolean) => void
  onEditing: (wanted: boolean) => void
  onSchedule: (fields: MeetingDraft) => void
  onSave: (id: string, fields: MeetingDraft) => void
  onDelete: (id: string) => void
}) => (
  <section class="next-meeting">
    <h2>Next meeting</h2>

    {next === undefined ? (
      <p class="form-note">Nothing in the diary. Put the next one in below.</p>
    ) : (
      <p>
        <strong>{next.title}</strong> — {whenItIs(next)}
        {next.link !== null && (
          <>
            {' · '}
            <a href={next.link} rel="noreferrer noopener" target="_blank">
              Join
            </a>
          </>
        )}
      </p>
    )}

    {next !== undefined && next.notes !== '' && (
      <div class="markdown-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(next.notes) }} />
    )}

    <p class="row">
      <button type="button" disabled={busy} onClick={() => onScheduling(!scheduling)}>
        {scheduling ? 'Never mind' : 'Put a meeting in the diary'}
      </button>
      {next !== undefined && (
        <>
          <IconButton
            icon="✏️"
            label={`Edit ${next.title}`}
            disabled={busy}
            onClick={() => onEditing(!editing)}
          />
          <IconButton
            icon="🗑️"
            label={`Take ${next.title} out of the diary`}
            disabled={busy}
            onClick={() => onDelete(next.id)}
          />
        </>
      )}
    </p>

    {scheduling && <MeetingFields busy={busy} onCancel={() => onScheduling(false)} onSave={onSchedule} />}

    {editing && next !== undefined && (
      <MeetingFields
        meeting={next}
        busy={busy}
        onCancel={() => onEditing(false)}
        onSave={(fields) => onSave(next.id, fields)}
      />
    )}
  </section>
)

const Point = ({
  point,
  viewerId,
  admin,
  busy,
  opened,
  editing,
  talk,
  upload,
  attendees,
  onOpen,
  onEdit,
  onSave,
  onDecide,
  onRemove,
}: {
  point: MeetingPointEntry
  viewerId: string | undefined
  admin: boolean
  busy: boolean
  opened: boolean
  editing: boolean
  talk: DreamTalk
  upload: UploadImage
  attendees: readonly { account_id: string; name: string | null }[]
  onOpen: () => void
  onEdit: (wanted: boolean) => void
  onSave: (changes: { title: string; body: string }) => void
  onDecide: (decision: string | null, decided_note: string | null) => void
  onRemove: () => void
}) => {
  const [deciding, setDeciding] = useState(false)
  const mine = point.author_account_id === viewerId

  if (editing) {
    return (
      <li class="point-row">
        <PointFields
          point={point}
          busy={busy}
          upload={upload}
          onCancel={() => onEdit(false)}
          onSave={onSave}
        />
      </li>
    )
  }

  return (
    <li class="point-row">
      <p class="point-what">
        <strong>{point.title}</strong>
      </p>

      {point.body !== '' && (
        <div
          class="markdown-preview point-note"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(point.body) }}
        />
      )}

      {point.decision !== null && (
        <div class="point-decision">
          <h3>Decided</h3>
          <div
            class="markdown-preview"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(point.decision) }}
          />
          {point.decided_note !== null && <p class="form-note">{point.decided_note}</p>}
        </div>
      )}

      <p class="form-note">
        Raised by{' '}
        {point.author_account_id === null ? (
          'somebody who has left'
        ) : (
          <a href={profilePage(point.author_account_id)}>{point.author_name ?? 'somebody'}</a>
        )}
      </p>

      <p class="point-actions">
        <IconButton
          icon="💬"
          label={`${opened ? 'Hide' : 'Show'} what has been said about ${point.title}`}
          disabled={busy}
          onClick={onOpen}
        />
        <button type="button" class="link-button" disabled={busy} onClick={() => setDeciding(!deciding)}>
          {point.decision === null ? 'Record decision' : 'Change the decision'}
        </button>
        {point.decision !== null && (
          <button type="button" class="link-button" disabled={busy} onClick={() => onDecide(null, null)}>
            Reopen
          </button>
        )}
        {mine && (
          <IconButton icon="✏️" label={`Edit ${point.title}`} disabled={busy} onClick={() => onEdit(true)} />
        )}
        {(mine || admin) && (
          <IconButton icon="🗑️" label={`Take ${point.title} off`} disabled={busy} onClick={onRemove} />
        )}
      </p>

      {deciding && (
        <DecisionFields
          point={point}
          busy={busy}
          upload={upload}
          onCancel={() => setDeciding(false)}
          onSave={(decision, note) => {
            onDecide(decision, note)
            setDeciding(false)
          }}
        />
      )}

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
        />
      )}
    </li>
  )
}

const PointFields = ({
  point,
  busy,
  upload,
  onCancel,
  onSave,
}: {
  point: MeetingPointEntry
  busy: boolean
  upload: UploadImage
  onCancel: () => void
  onSave: (changes: { title: string; body: string }) => void
}) => {
  const [title, setTitle] = useState(point.title)
  const [body, setBody] = useState(point.body)

  return (
    <div class="point-edit">
      <label class="field">
        <span>What is it?</span>
        <input
          type="text"
          maxLength={MAX_TITLE}
          aria-label={`Point, for ${point.title}`}
          value={title}
          onInput={(typed) => setTitle(typed.currentTarget.value)}
        />
      </label>

      <MarkdownField
        label={`Details, for ${point.title}`}
        value={body}
        maxLength={MAX_POST}
        upload={upload}
        onInput={setBody}
      />

      <p class="row">
        <PendingButton
          busy={busy}
          label="Save"
          busyLabel="Saving…"
          type="button"
          onClick={() => onSave({ title: title.trim(), body: body.trim() })}
        />
        <button type="button" class="link-button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </p>
    </div>
  )
}

const DecisionFields = ({
  point,
  busy,
  upload,
  onCancel,
  onSave,
}: {
  point: MeetingPointEntry
  busy: boolean
  upload: UploadImage
  onCancel: () => void
  onSave: (decision: string, note: string | null) => void
}) => {
  const [decision, setDecision] = useState(point.decision ?? '')
  const [note, setNote] = useState(point.decided_note ?? '')

  return (
    <div class="point-decide">
      <MarkdownField
        label={`Decision, for ${point.title}`}
        value={decision}
        maxLength={MAX_POST}
        upload={upload}
        onInput={setDecision}
      />

      <label class="field">
        <span>Where was it decided?</span>
        <input
          type="text"
          maxLength={MAX_DECIDED_NOTE}
          placeholder="Planning call Oct 20"
          aria-label={`Where it was decided, for ${point.title}`}
          value={note}
          onInput={(typed) => setNote(typed.currentTarget.value)}
        />
      </label>

      <p class="row">
        <PendingButton
          busy={busy}
          label="Record it"
          busyLabel="Recording…"
          type="button"
          disabled={decision.trim() === ''}
          onClick={() => onSave(decision.trim(), note.trim() === '' ? null : note.trim())}
        />
        <button type="button" class="link-button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </p>
    </div>
  )
}

const MeetingFields = ({
  meeting,
  busy,
  onCancel,
  onSave,
}: {
  meeting?: Meeting | undefined
  busy: boolean
  onCancel: () => void
  onSave: (fields: MeetingDraft) => void
}) => {
  const [title, setTitle] = useState(meeting?.title ?? 'Planning call')
  const [starts, setStarts] = useState(toLocalInput(meeting?.starts_at ?? null))
  const [ends, setEnds] = useState(toLocalInput(meeting?.ends_at ?? null))
  const [link, setLink] = useState(meeting?.link ?? '')
  const [notes, setNotes] = useState(meeting?.notes ?? '')

  const startsAt = fromLocalInput(starts)

  return (
    <div class="meeting-edit">
      <label class="field">
        <span>What is it?</span>
        <input
          type="text"
          maxLength={MAX_TITLE}
          aria-label="What the meeting is"
          value={title}
          onInput={(typed) => setTitle(typed.currentTarget.value)}
        />
      </label>

      <label class="field">
        <span>When does it start?</span>
        <input
          type="datetime-local"
          aria-label="When the meeting starts"
          value={starts}
          onInput={(typed) => setStarts(typed.currentTarget.value)}
        />
      </label>

      <label class="field">
        <span>And when does it end? (an hour, if you leave this)</span>
        <input
          type="datetime-local"
          aria-label="When the meeting ends"
          value={ends}
          onInput={(typed) => setEnds(typed.currentTarget.value)}
        />
      </label>

      <label class="field">
        <span>A link to join on</span>
        <input
          type="url"
          maxLength={MAX_MEETING_LINK}
          placeholder="https://meet.example/abc-defg-hij"
          aria-label="A link to join the meeting on"
          value={link}
          onInput={(typed) => setLink(typed.currentTarget.value)}
        />
      </label>

      <label class="field">
        <span>Anything else about it?</span>
        <textarea
          maxLength={MAX_NOTES}
          rows={rowsFor(notes, 2)}
          aria-label="Anything else about the meeting"
          value={notes}
          onInput={(typed) => setNotes(typed.currentTarget.value)}
        />
      </label>

      <p class="row">
        <PendingButton
          busy={busy}
          label={meeting === undefined ? 'Put it in' : 'Save'}
          busyLabel="Saving…"
          type="button"
          disabled={title.trim() === '' || startsAt === null}
          onClick={() => {
            if (startsAt === null) return

            onSave({
              title: title.trim(),
              starts_at: startsAt,
              ends_at: fromLocalInput(ends),
              link: link.trim() === '' ? null : link.trim(),
              notes: notes.trim(),
            })
          }}
        />
        <button type="button" class="link-button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </p>
    </div>
  )
}
