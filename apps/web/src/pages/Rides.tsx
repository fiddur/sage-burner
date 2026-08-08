import type { RideEntry, RideKind } from '@sage-burner/shared'

import { MAX_NOTES, MAX_RIDE_PLACE, rideKinds } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { useSelectedBurn } from '../burn.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { IconButton } from '../components/IconButton.tsx'
import { NoBurn } from '../components/NoBurn.tsx'
import { PendingButton } from '../components/PendingButton.tsx'
import { Refreshing } from '../components/Refreshing.tsx'
import { useAction, useLoad } from '../load.ts'
import { rowsFor } from '../textarea.ts'
import { isApproved, useViewer } from '../viewer.tsx'

export type RidesApi = Pick<ApiClient, 'getRides' | 'addRide' | 'updateRide' | 'deleteRide'>

/** What each half of the board is called, and what its empty state says. */
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

/**
 * Getting to the burn and back (#26) — the spreadsheet's Rideshares tab.
 *
 * Two lists: who is looking for a lift, and who has room. Both carry the poster's
 * **contact**, which is the point of the page and is why it is behind the members
 * gate: the spreadsheet was a publicly linked document with phone numbers in it, and
 * this is the same board without that.
 *
 * The contact comes from the account rather than from the row, so a number changed on
 * the details page is changed on every journey at once.
 *
 * **Your own journey is yours**, unlike the lanes or the lead-roles register, which
 * anyone may rearrange: a row here is somebody's statement about their own travel.
 * Nothing claims a seat — the board is two lists, and whoever wants one gets in touch.
 */
export const Rides = ({ api }: { api: RidesApi }) => {
  const viewer = useViewer()
  const approved = isApproved(viewer)
  const burn = useSelectedBurn()
  const [draft, setDraft] = useState(BLANK)
  const [editing, setEditing] = useState<string | undefined>(undefined)

  const { loaded, refreshing, reload } = useLoad(
    async (signal) => (burn === undefined ? [] : (await api.getRides(burn.event.id, signal)).rides),
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
        // Only ever meaningful on an offer, and the schema refuses a negative one.
        seats: draft.kind === 'offers' ? Math.max(0, Number(draft.seats) || 0) : 0,
        notes: draft.notes.trim(),
      })
      setDraft(BLANK)
    }, 'Could not post that.')
  }

  const rides = loaded.status === 'ready' ? loaded.data : []
  const mine = viewer.account?.id

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
              busy={busy}
              editing={editing}
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

      {burn !== undefined && (
        <form
          class="form"
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault()
            post()
          }}
        >
          <h2>Say something about your journey</h2>

          <label class="field">
            <span>Which is it?</span>
            <select
              name="kind"
              value={draft.kind}
              onChange={(changed) =>
                setDraft((current) => ({ ...current, kind: changed.currentTarget.value as RideKind }))
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
              onInput={(typed) => setDraft((current) => ({ ...current, from: typed.currentTarget.value }))}
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
              onInput={(typed) => setDraft((current) => ({ ...current, when: typed.currentTarget.value }))}
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
                onInput={(typed) => setDraft((current) => ({ ...current, seats: typed.currentTarget.value }))}
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
              onInput={(typed) => setDraft((current) => ({ ...current, notes: typed.currentTarget.value }))}
            />
          </label>

          <PendingButton busy={busy} label="Post it" busyLabel="Posting…" type="submit" />
        </form>
      )}
    </GuardedPage>
  )
}

/**
 * One half of the board.
 *
 * The heading is the section's, so a row says only what is particular to it — where
 * from, when, how much room, and who to ask.
 */
const Half = ({
  rides,
  empty,
  mine,
  busy,
  editing,
  onEdit,
  onSave,
  onWithdraw,
}: {
  rides: readonly RideEntry[]
  empty: string
  mine: string | undefined
  busy: boolean
  editing: string | undefined
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
              {row.name ?? 'Name not filled in yet'} · {row.contact ?? 'no contact given'}
            </p>
            {row.notes !== '' && <p class="ride-notes">{row.notes}</p>}

            {/* Your own only. The lanes and the register are the burn's shared
                furniture; this is what somebody said about their own travel. */}
            {row.account_id === mine && (
              <p class="ride-actions">
                <IconButton
                  icon="✏️"
                  label={`Edit your journey from ${row.from}`}
                  disabled={busy}
                  onClick={() => onEdit(row.id)}
                />
                <IconButton
                  icon="🗑️"
                  label={`Take down your journey from ${row.from}`}
                  disabled={busy}
                  onClick={() => onWithdraw(row.id)}
                />
              </p>
            )}
          </li>
        ),
      )}
    </ul>
  )
}

/** The same fields as the form below, on a row that already exists. */
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
