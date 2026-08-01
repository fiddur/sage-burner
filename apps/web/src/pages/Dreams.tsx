import type { Place, Session } from '@sage-burner/shared'

import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { fromLocalInput, toLocalInput } from '../datetime.ts'
import { isMember, useViewer } from '../viewer.tsx'

export type DreamsApi = Pick<
  ApiClient,
  'getSessions' | 'offerSession' | 'updateSession' | 'withdrawSession' | 'getPlaces'
>

type Loaded =
  | { status: 'loading' }
  | { status: 'ready'; sessions: readonly Session[]; places: readonly Place[] }
  | { status: 'failed'; message: string }

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
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [title, setTitle] = useState('')
  const [editing, setEditing] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (!member) return undefined

    const controller = new AbortController()

    Promise.all([api.getSessions(controller.signal), api.getPlaces(controller.signal)])
      .then(([dreams, places]) => {
        if (controller.signal.aborted) return
        setLoaded({ status: 'ready', sessions: dreams.sessions, places: places.places })
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return
        setLoaded({
          status: 'failed',
          message: isApiError(failure) ? failure.message : 'Could not load the dreams.',
        })
      })

    return () => {
      controller.abort()
    }
  }, [api, member, reload])

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setError(undefined)
    setBusy(true)
    try {
      await action()
      setReload((count) => count + 1)
    } catch (failure) {
      setError(isApiError(failure) ? failure.message : fallback)
    } finally {
      setBusy(false)
    }
  }

  const offer = () => {
    if (title.trim() === '') {
      setError('Give your dream a name.')
      return
    }

    void run(async () => {
      await api.offerSession({ title: title.trim(), description: '' })
      setTitle('')
    }, 'Could not offer that.')
  }

  if (viewer.status === 'loading') {
    return (
      <section class="page">
        <h1>Dreams</h1>
        <p class="form-note">One moment…</p>
      </section>
    )
  }

  if (!member) {
    return (
      <section class="page">
        <h1>Dreams</h1>
        <p>
          This is for members. <a href="/login">Log in</a> to see it.
        </p>
      </section>
    )
  }

  const dreams = loaded.status === 'ready' ? loaded.sessions : []
  const places = loaded.status === 'ready' ? loaded.places : []

  return (
    <section class="page">
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
                busy={busy}
                onCancel={() => setEditing(undefined)}
                onSave={(changes) =>
                  void run(async () => {
                    await api.updateSession(dream.id, changes)
                    setEditing(undefined)
                  }, 'Could not save that.')
                }
              />
            ) : (
              <>
                <span class="dream-title">{dream.title}</span>
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
                  onClick={() => void run(() => api.withdrawSession(dream.id), 'Could not withdraw that.')}
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
            maxLength={200}
            aria-required
            value={title}
            onInput={(inputEvent) => setTitle(inputEvent.currentTarget.value)}
          />
        </label>

        <button type="submit" disabled={busy}>
          Offer it
        </button>
      </form>
    </section>
  )
}

const DreamFields = ({
  dream,
  places,
  busy,
  onSave,
  onCancel,
}: {
  dream: Session
  places: readonly Place[]
  busy: boolean
  onSave: (changes: {
    title: string
    description: string
    place_id: string | null
    time_slot_start: string | null
    time_slot_end: string | null
  }) => void
  onCancel: () => void
}) => {
  const [title, setTitle] = useState(dream.title)
  const [description, setDescription] = useState(dream.description)
  const [placeId, setPlaceId] = useState(dream.place_id ?? '')
  const [start, setStart] = useState(toLocalInput(dream.time_slot_start))
  const [end, setEnd] = useState(toLocalInput(dream.time_slot_end))

  return (
    <div class="dream-edit">
      <label class="field">
        <span>What is it?</span>
        <input
          type="text"
          maxLength={200}
          aria-label={`Title of ${dream.title}`}
          value={title}
          onInput={(inputEvent) => setTitle(inputEvent.currentTarget.value)}
        />
      </label>

      <label class="field">
        <span>Tell people about it</span>
        <textarea
          maxLength={20_000}
          aria-label={`Description of ${dream.title}`}
          value={description}
          onInput={(inputEvent) => setDescription(inputEvent.currentTarget.value)}
        />
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
          value={start}
          onInput={(inputEvent) => setStart(inputEvent.currentTarget.value)}
        />
      </label>

      <label class="field">
        <span>Ends</span>
        <input
          type="datetime-local"
          aria-label={`End of ${dream.title}`}
          value={end}
          onInput={(inputEvent) => setEnd(inputEvent.currentTarget.value)}
        />
      </label>

      <button
        type="button"
        disabled={busy}
        onClick={() =>
          onSave({
            title: title.trim(),
            description,
            place_id: placeId === '' ? null : placeId,
            time_slot_start: fromLocalInput(start),
            time_slot_end: fromLocalInput(end),
          })
        }
      >
        Save
      </button>
      <button type="button" class="link-button" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}
