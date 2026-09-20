import type { EventAttendeesResponse, RideEntry, RideKind } from '@sage-burner/shared'

import { MAX_NOTES, MAX_RIDE_PLACE, profilePage, RIDE_PARAM, rideKinds, rideTitle } from '@sage-burner/shared'
import { useLocation } from 'preact-iso'
import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { DreamTalk } from '../components/OpenedDream.tsx'
import type { UploadImage } from '../image-upload.ts'

import { useSelectedBurn } from '../burn.tsx'
import { Destroy } from '../components/Destroy.tsx'
import { DreamThread } from '../components/DreamThread.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { IconButton } from '../components/IconButton.tsx'
import { NoBurn } from '../components/NoBurn.tsx'
import { useDreamThread } from '../components/OpenedDream.tsx'
import { PendingButton } from '../components/PendingButton.tsx'
import { Refreshing } from '../components/Refreshing.tsx'
import { useAction, useLoad } from '../load.ts'
import { rowsFor } from '../textarea.ts'
import { isAdmin, isApproved, useViewer } from '../viewer.tsx'

export type RidesApi = Pick<
  ApiClient,
  | 'getRides'
  | 'addRide'
  | 'updateRide'
  | 'deleteRide'
  | 'getEventAttendees'
  | 'getThread'
  | 'postComment'
  | 'updateComment'
  | 'deleteComment'
  | 'supportComment'
  | 'withdrawSupportForComment'
  | 'uploadImage'
>

type Attendee = EventAttendeesResponse['attendees'][number]

const HALVES: Record<RideKind, { heading: string; empty: string }> = {
  needs: {
    heading: 'Looking for a lift',
    empty: 'Nobody is looking for a lift yet.',
  },
  offers: {
    heading: 'Offering a lift',
    empty: 'Nobody has offered one yet.',
  },
}

const BLANK = { kind: 'needs' as RideKind, from: '', when: '', seats: '0', notes: '' }

export const Rides = ({ api }: { api: RidesApi }) => {
  const viewer = useViewer()
  const approved = isApproved(viewer)
  const burn = useSelectedBurn()
  const [draft, setDraft] = useState(BLANK)
  const [editing, setEditing] = useState<string | undefined>(undefined)
  const [opened, setOpened] = useState<string | undefined>(undefined)

  const { loaded, refreshing, reload } = useLoad(
    async (signal) => {
      if (burn === undefined) return { rides: [], attendees: [] }

      const [board, coming] = await Promise.all([
        api.getRides(burn.event.id, signal),
        api.getEventAttendees(burn.event.id, signal),
      ])

      return { rides: board.rides, attendees: coming.attendees }
    },
    {
      enabled: approved,
      key: burn?.event.id ?? '',
      fallback: 'Could not load the rideshare board.',
      live: true,
      remember: 'rides',
    },
  )

  const { busy, error, setError, run } = useAction(reload)

  const post = () => {
    if (burn === undefined) return
    if (draft.from.trim() === '' || draft.when.trim() === '') {
      setError('Say where from and roughly when, so somebody can answer it.')
      return
    }

    run(async () => {
      await api.addRide(burn.event.id, {
        kind: draft.kind,
        from: draft.from.trim(),
        when: draft.when.trim(),
        seats: draft.kind === 'offers' ? Math.max(0, Number(draft.seats) || 0) : 0,
        notes: draft.notes.trim(),
      })
      setDraft(BLANK)
    }, 'Could not post that.')
  }

  const { rides, attendees } = loaded.status === 'ready' ? loaded.data : { rides: [], attendees: [] }
  const mine = viewer.account?.id

  const asked: string | undefined = useLocation().query?.[RIDE_PARAM]

  useEffect(() => {
    if (asked !== undefined) setOpened(asked)
  }, [asked])

  const talk = useDreamThread({
    api,
    threadId: rides.find((row) => row.id === opened)?.thread_id,
    run,
  })

  return (
    <GuardedPage title="Rides" require="approved">
      <h1>
        Rides <Refreshing on={refreshing} />
      </h1>

      <p class="form-note">
        Getting there and back. Everyone here can see each other's contact details, so say what you need and
        talk to each other — nothing on this page books a seat.
      </p>

      <ErrorText message={error} />

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}
      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      {loaded.status === 'ready' && burn === undefined && <NoBurn absent="there is nowhere to travel to" />}

      {loaded.status === 'ready' &&
        burn !== undefined &&
        rideKinds.map((kind) => (
          <section key={kind}>
            <h2>{HALVES[kind].heading}</h2>
            <Half
              rides={rides.filter((row) => row.kind === kind)}
              empty={HALVES[kind].empty}
              mine={mine}
              admin={isAdmin(viewer)}
              attendees={attendees}
              busy={busy}
              editing={editing}
              opened={opened}
              talk={talk}
              upload={api.uploadImage}
              onOpen={(id) => setOpened(opened === id ? undefined : id)}
              onEdit={setEditing}
              onSave={(id, changes) =>
                run(async () => {
                  await api.updateRide(id, changes)
                  setEditing(undefined)
                }, 'Could not save that.')
              }
              onWithdraw={(id) => run(() => api.deleteRide(id), 'Could not take that down.')}
            />
          </section>
        ))}

      {burn !== undefined && <NewJourney draft={draft} busy={busy} onDraft={setDraft} onPost={post} />}
    </GuardedPage>
  )
}

const NewJourney = ({
  draft,
  busy,
  onDraft,
  onPost,
}: {
  draft: typeof BLANK
  busy: boolean
  onDraft: (next: (current: typeof BLANK) => typeof BLANK) => void
  onPost: () => void
}) => (
  <form
    class="form"
    onSubmit={(submitEvent) => {
      submitEvent.preventDefault()
      onPost()
    }}
  >
    <h2>Say something about your journey</h2>

    <label class="field">
      <span>Which is it?</span>
      <select
        name="kind"
        value={draft.kind}
        onChange={(changed) =>
          onDraft((current) => ({ ...current, kind: changed.currentTarget.value as RideKind }))
        }
      >
        <option value="needs">I am looking for a lift</option>
        <option value="offers">I have room in a car</option>
      </select>
    </label>

    <label class="field">
      <span>From where?</span>
      <input
        type="text"
        name="from"
        maxLength={MAX_RIDE_PLACE}
        aria-required
        value={draft.from}
        onInput={(typed) => onDraft((current) => ({ ...current, from: typed.currentTarget.value }))}
      />
    </label>

    <label class="field">
      <span>When, roughly?</span>
      <input
        type="text"
        name="when"
        maxLength={MAX_RIDE_PLACE}
        aria-required
        value={draft.when}
        onInput={(typed) => onDraft((current) => ({ ...current, when: typed.currentTarget.value }))}
      />
    </label>

    {draft.kind === 'offers' && (
      <label class="field">
        <span>How many seats?</span>
        <input
          type="number"
          name="seats"
          min={0}
          value={draft.seats}
          onInput={(typed) => onDraft((current) => ({ ...current, seats: typed.currentTarget.value }))}
        />
      </label>
    )}

    <label class="field">
      <span>Anything else?</span>
      <textarea
        name="notes"
        maxLength={MAX_NOTES}
        rows={rowsFor(draft.notes)}
        value={draft.notes}
        onInput={(typed) => onDraft((current) => ({ ...current, notes: typed.currentTarget.value }))}
      />
    </label>

    <PendingButton busy={busy} label="Post it" busyLabel="Posting…" type="submit" />
  </form>
)

const Half = ({
  rides,
  empty,
  mine,
  admin,
  attendees,
  busy,
  editing,
  opened,
  talk,
  upload,
  onOpen,
  onEdit,
  onSave,
  onWithdraw,
}: {
  rides: readonly RideEntry[]
  empty: string
  mine: string | undefined
  admin: boolean
  attendees: readonly Attendee[]
  busy: boolean
  editing: string | undefined
  opened: string | undefined
  talk: DreamTalk
  upload: UploadImage
  onOpen: (id: string) => void
  onEdit: (id: string | undefined) => void
  onSave: (id: string, changes: { from: string; when: string; seats: number; notes: string }) => void
  onWithdraw: (id: string) => void
}) => {
  if (rides.length === 0) return <p class="form-note">{empty}</p>

  return (
    <ul class="ride-list">
      {rides.map((row) =>
        editing === row.id ? (
          <li key={row.id} class="ride-row">
            <RideFields ride={row} busy={busy} onCancel={() => onEdit(undefined)} onSave={onSave} />
          </li>
        ) : (
          <li key={row.id} class="ride-row">
            <p class="ride-journey">
              <strong>{row.from}</strong> · {row.when}
              {row.kind === 'offers' && row.seats > 0 && ` · ${row.seats} seats`}
            </p>
            <p class="form-note">
              <a href={profilePage(row.account_id)}>{row.name ?? 'Name not filled in yet'}</a> ·{' '}
              {row.contact ?? 'no contact given'}
            </p>
            {row.notes !== '' && <p class="ride-notes">{row.notes}</p>}

            <p class="ride-actions">
              <IconButton
                icon="comment"
                label={`${opened === row.id ? 'Hide' : 'Show'} what has been said about ${rideTitle(row)}`}
                disabled={busy}
                onClick={() => onOpen(row.id)}
              />
              {row.account_id === mine && (
                <>
                  <IconButton
                    icon="edit"
                    label={`Edit your journey from ${row.from}`}
                    disabled={busy}
                    onClick={() => onEdit(row.id)}
                  />
                  <Destroy
                    what={`your journey from ${row.from}`}
                    verb="Take down"
                    busy={busy}
                    onDestroy={() => onWithdraw(row.id)}
                  />
                </>
              )}
            </p>

            {opened === row.id && (
              <DreamThread
                thread={talk.thread}
                viewerId={mine}
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
          </li>
        ),
      )}
    </ul>
  )
}

const RideFields = ({
  ride,
  busy,
  onCancel,
  onSave,
}: {
  ride: RideEntry
  busy: boolean
  onCancel: () => void
  onSave: (id: string, changes: { from: string; when: string; seats: number; notes: string }) => void
}) => {
  const [from, setFrom] = useState(ride.from)
  const [when, setWhen] = useState(ride.when)
  const [seats, setSeats] = useState(String(ride.seats))
  const [notes, setNotes] = useState(ride.notes)

  return (
    <div class="ride-edit">
      <label class="field">
        <span>From where?</span>
        <input
          type="text"
          maxLength={MAX_RIDE_PLACE}
          aria-label={`From, for your journey from ${ride.from}`}
          value={from}
          onInput={(typed) => setFrom(typed.currentTarget.value)}
        />
      </label>

      <label class="field">
        <span>When, roughly?</span>
        <input
          type="text"
          maxLength={MAX_RIDE_PLACE}
          aria-label={`When, for your journey from ${ride.from}`}
          value={when}
          onInput={(typed) => setWhen(typed.currentTarget.value)}
        />
      </label>

      {ride.kind === 'offers' && (
        <label class="field">
          <span>How many seats?</span>
          <input
            type="number"
            min={0}
            aria-label={`Seats, for your journey from ${ride.from}`}
            value={seats}
            onInput={(typed) => setSeats(typed.currentTarget.value)}
          />
        </label>
      )}

      <label class="field">
        <span>Anything else?</span>
        <textarea
          maxLength={MAX_NOTES}
          rows={rowsFor(notes)}
          aria-label={`Notes, for your journey from ${ride.from}`}
          value={notes}
          onInput={(typed) => setNotes(typed.currentTarget.value)}
        />
      </label>

      <p class="row">
        <PendingButton
          busy={busy}
          label="Save"
          busyLabel="Saving…"
          type="button"
          onClick={() =>
            onSave(ride.id, {
              from: from.trim(),
              when: when.trim(),
              seats: ride.kind === 'offers' ? Math.max(0, Number(seats) || 0) : 0,
              notes: notes.trim(),
            })
          }
        />
        <button type="button" class="link-button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </p>
    </div>
  )
}
