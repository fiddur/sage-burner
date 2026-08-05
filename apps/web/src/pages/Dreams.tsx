import type { EventAttendeesResponse, Place, Session, SessionUpdate } from '@sage-burner/shared'

import { MAX_DESCRIPTION, MAX_TITLE } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { useSelectedBurn } from '../burn.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { fromLocalInput, toLocalInput } from '../datetime.ts'
import { useAction, useLoad } from '../load.ts'
import { isMember, useViewer } from '../viewer.tsx'

export type DreamsApi = Pick<
  ApiClient,
  'getSessions' | 'offerSession' | 'updateSession' | 'withdrawSession' | 'getPlaces' | 'getEventAttendees'
>

const placeLabel = (places: readonly Place[], id: string | null) => {
  const found = places.find((row) => row.id === id)

  return found === undefined ? undefined : `${found.emoji} ${found.name}`
}

const when = (dream: Session) =>
  dream.time_slot_start === null
    ? undefined
    : new Date(dream.time_slot_start).toLocaleString(undefined, {
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })

/**
 * Dreams — the workshops, ceremonies and happenings members offer each other.
 *
 * A dream with no time is *offered but not yet scheduled*, which is where most
 * of them sit right up until the burn. Anyone here can arrange the schedule, not
 * only whoever offered a given dream.
 */
export const Dreams = ({ api }: { api: DreamsApi }) => {
  const viewer = useViewer()
  const member = isMember(viewer)
  const [title, setTitle] = useState('')
  const [editing, setEditing] = useState<string | undefined>(undefined)

  // The burn comes first: since #156 the lanes belong to one. With no burn open
  // there is nothing to offer a dream to either, and `getSessions` says so anyway.
  const burn = useSelectedBurn()
  const { loaded, reload } = useLoad(
    async (signal) => {
      if (burn === undefined) return { sessions: [], places: [], attendees: [] }

      const [dreams, places, attendees] = await Promise.all([
        api.getSessions(burn.event.id, signal),
        api.getPlaces(burn.event.id, signal),
        api.getEventAttendees(burn.event.id, signal),
      ])

      return { sessions: dreams.sessions, places: places.places, attendees: attendees.attendees }
    },
    { enabled: member, key: burn?.event.id ?? '', fallback: 'Could not load the dreams.' },
  )

  const { busy, error, setError, run } = useAction(reload)

  const offer = () => {
    if (title.trim() === '') {
      setError('Give your dream a name.')
      return
    }

    run(async () => {
      if (burn === undefined) return
      await api.offerSession(burn.event.id, { title: title.trim(), description: '' })
      setTitle('')
    }, 'Could not offer that.')
  }

  const dreams = loaded.status === 'ready' ? loaded.data.sessions : []
  const places = loaded.status === 'ready' ? loaded.data.places : []
  const attendees = loaded.status === 'ready' ? loaded.data.attendees : []

  return (
    <GuardedPage title="Dreams" require="member">
      <h1>Dreams</h1>

      <p class="form-note">
        Workshops, ceremonies, happenings — whatever you want to offer. Say what it is now and work out when
        later; most dreams have no time until quite close to the burn.
      </p>

      {error !== undefined && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}

      {loaded.status === 'failed' && (
        <p class="form-error" role="alert">
          {loaded.message}
        </p>
      )}

      {loaded.status === 'ready' && dreams.length === 0 && (
        <p class="form-note">Nobody has offered a dream yet. Yours can be the first.</p>
      )}

      <ol class="dream-list">
        {dreams.map((dream) => (
          <li key={dream.id} class="dream-row">
            {editing === dream.id ? (
              <DreamFields
                dream={dream}
                places={places}
                attendees={attendees}
                busy={busy}
                onCancel={() => setEditing(undefined)}
                onSave={(changes) =>
                  run(async () => {
                    await api.updateSession(dream.id, changes)
                    setEditing(undefined)
                  }, 'Could not save that.')
                }
              />
            ) : (
              <>
                <span class="dream-title">
                  {dream.title}
                  {dream.repeatable && (
                    <span class="dream-repeats">
                      <span aria-hidden="true">↻</span>
                      <span class="visually-hidden">Can be planned more than once</span>
                    </span>
                  )}
                </span>
                <span class="dream-when">{when(dream) ?? 'not scheduled yet'}</span>
                <span class="dream-place">{placeLabel(places, dream.place_id) ?? '—'}</span>

                <button
                  type="button"
                  class="link-button"
                  disabled={busy}
                  aria-label={`Edit ${dream.title}`}
                  onClick={() => setEditing(dream.id)}
                >
                  ✏️
                </button>
                <button
                  type="button"
                  class="link-button"
                  disabled={busy}
                  aria-label={`Withdraw ${dream.title}`}
                  onClick={() => run(() => api.withdrawSession(dream.id), 'Could not withdraw that.')}
                >
                  🗑️
                </button>
              </>
            )}
          </li>
        ))}
      </ol>

      <form
        class="form"
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault()
          offer()
        }}
      >
        <h2>Offer a dream</h2>

        <label class="field">
          <span>What is it?</span>
          <input
            type="text"
            name="title"
            maxLength={MAX_TITLE}
            aria-required
            value={title}
            onInput={(inputEvent) => setTitle(inputEvent.currentTarget.value)}
          />
        </label>

        <button type="submit" disabled={busy}>
          Offer it
        </button>
      </form>
    </GuardedPage>
  )
}

const DreamFields = ({
  dream,
  places,
  attendees,
  busy,
  onSave,
  onCancel,
}: {
  dream: Session
  places: readonly Place[]
  attendees: readonly EventAttendeesResponse['attendees'][number][]
  busy: boolean
  onSave: (changes: SessionUpdate) => void
  onCancel: () => void
}) => {
  const [title, setTitle] = useState(dream.title)
  const [facilitator, setFacilitator] = useState(dream.facilitator_account_id ?? '')
  const [description, setDescription] = useState(dream.description)
  const [repeatable, setRepeatable] = useState(dream.repeatable)
  const [placeId, setPlaceId] = useState(dream.place_id ?? '')
  const [start, setStart] = useState(toLocalInput(dream.time_slot_start))
  const [end, setEnd] = useState(toLocalInput(dream.time_slot_end))

  // Only the fields this form actually changed. Sending all five would carry the
  // values it loaded at mount, so fixing a typo in the title would put the place
  // and slot back as they were then, undoing whatever someone else scheduled
  // meanwhile — the ordinary case on a page several people edit at once.
  //
  // Each comparison is in the form's own units. Comparing a round-tripped
  // timestamp against the stored one instead would call an untouched slot
  // changed whenever the stored value carries seconds, because the inputs are
  // minute-precision, and quietly zero them.
  const edits = (): SessionUpdate => ({
    ...(title.trim() === dream.title ? {} : { title: title.trim() }),
    ...(description === dream.description ? {} : { description }),
    ...(placeId === (dream.place_id ?? '') ? {} : { place_id: placeId === '' ? null : placeId }),
    ...(start === toLocalInput(dream.time_slot_start) ? {} : { time_slot_start: fromLocalInput(start) }),
    ...(end === toLocalInput(dream.time_slot_end) ? {} : { time_slot_end: fromLocalInput(end) }),
    ...(facilitator === (dream.facilitator_account_id ?? '')
      ? {}
      : { facilitator_account_id: facilitator === '' ? null : facilitator }),
    ...(repeatable === dream.repeatable ? {} : { repeatable }),
  })

  return (
    <div class="dream-edit">
      <label class="field">
        <span>What is it?</span>
        <input
          type="text"
          maxLength={MAX_TITLE}
          aria-label={`Title of ${dream.title}`}
          value={title}
          onInput={(inputEvent) => setTitle(inputEvent.currentTarget.value)}
        />
      </label>

      <label class="field">
        <span>Tell people about it</span>
        <textarea
          maxLength={MAX_DESCRIPTION}
          aria-label={`Description of ${dream.title}`}
          value={description}
          onInput={(inputEvent) => setDescription(inputEvent.currentTarget.value)}
        />
      </label>

      {/* Only people coming to this burn: the API refuses anyone else, since
          somebody who is not there cannot run it. */}
      <label class="field">
        <span>Who is facilitating?</span>
        <select
          aria-label={`Facilitator for ${dream.title}`}
          value={facilitator}
          onChange={(changeEvent) => setFacilitator(changeEvent.currentTarget.value)}
        >
          <option value="">Nobody yet</option>
          {attendees.map((person) => (
            <option key={person.account_id} value={person.account_id}>
              {person.name ?? 'Name not filled in yet'}
            </option>
          ))}
        </select>
      </label>

      <label class="field">
        <span>Where</span>
        <select
          aria-label={`Place for ${dream.title}`}
          value={placeId}
          onChange={(changeEvent) => setPlaceId(changeEvent.currentTarget.value)}
        >
          <option value="">Nowhere yet</option>
          {places.map((row) => (
            <option key={row.id} value={row.id}>
              {row.emoji} {row.name}
            </option>
          ))}
        </select>
      </label>

      <label class="field">
        <span>Starts</span>
        <input
          type="datetime-local"
          aria-label={`Start of ${dream.title}`}
          max={end === '' ? undefined : end}
          value={start}
          onInput={(inputEvent) => setStart(inputEvent.currentTarget.value)}
        />
      </label>

      <label class="field">
        <span>Ends</span>
        <input
          type="datetime-local"
          aria-label={`End of ${dream.title}`}
          min={start === '' ? undefined : start}
          value={end}
          onInput={(inputEvent) => setEnd(inputEvent.currentTarget.value)}
        />
      </label>

      {/* Placing it in the grid then copies it rather than moving it. */}
      <label class="field-inline">
        <input
          type="checkbox"
          aria-label={`Plan ${dream.title} more than once`}
          checked={repeatable}
          onChange={(changeEvent) => setRepeatable(changeEvent.currentTarget.checked)}
        />
        <span>Can be planned more than once</span>
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
