import type { CopySourcesResponse, Place, PlaceColor } from '@sage-burner/shared'

import { MAX_EMOJI, MAX_PLACE_NAME, placeColors } from '@sage-burner/shared'
import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { isApproved, useViewer } from '../viewer.tsx'

export type PlacesApi = Pick<
  ApiClient,
  | 'getActiveEvent'
  | 'getPlaces'
  | 'addPlace'
  | 'updatePlace'
  | 'deletePlace'
  | 'reorderPlaces'
  | 'getPlaceSources'
  | 'copyPlaces'
>

type Source = CopySourcesResponse['sources'][number]

type Loaded =
  | { status: 'loading' }
  | { status: 'no-burn' }
  | { status: 'ready'; eventId: string; places: readonly Place[]; sources: readonly Source[] }
  | { status: 'failed'; message: string }

interface Draft {
  name: string
  emoji: string
  color: PlaceColor
}

const BLANK: Draft = { name: '', emoji: '', color: 'blue' }

const NEEDS_BOTH = 'A place needs a name and an emoji — both show in the schedule.'

const isBlank = (fields: { name: string; emoji: string }) =>
  fields.name.trim() === '' || fields.emoji.trim() === ''

const swap = (ids: readonly string[], index: number, by: -1 | 1): string[] | undefined => {
  const target = index + by
  if (target < 0 || target >= ids.length) return undefined

  const next = [...ids]
  const moved = next[index]
  const displaced = next[target]
  if (moved === undefined || displaced === undefined) return undefined
  next[index] = displaced
  next[target] = moved

  return next
}

const moveTo = (ids: readonly string[], from: number, to: number): string[] | undefined => {
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return undefined

  const next = [...ids]
  const [moved] = next.splice(from, 1)
  if (moved === undefined) return undefined
  next.splice(to, 0, moved)

  return next
}

/**
 * Where a dream can happen — one grid per burn, following the burn that is open.
 *
 * The role check decides what to render, not what is allowed: the API refuses
 * anyone without a role whatever this does.
 *
 * Per burn since #156, so a summer-only spot is not a lane in the winter grid. The
 * overlap between burns is large, which is why an empty grid offers to copy a
 * previous one rather than only an empty form.
 */
export const AdminPlaces = ({ api }: { api: PlacesApi }) => {
  const viewer = useViewer()
  const approved = isApproved(viewer)
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [draft, setDraft] = useState<Draft>(BLANK)
  const [editing, setEditing] = useState<string | undefined>(undefined)
  const [dragging, setDragging] = useState<number | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (!approved) return undefined

    const controller = new AbortController()

    api
      .getActiveEvent(controller.signal)
      .then(async (active) => {
        if (active.event === null) return { status: 'no-burn' } as const

        const eventId = active.event.id
        const [places, sources] = await Promise.all([
          api.getPlaces(eventId, controller.signal),
          api.getPlaceSources(eventId, controller.signal),
        ])

        return { status: 'ready', eventId, places: places.places, sources: sources.sources } as const
      })
      .then((next) => {
        if (!controller.signal.aborted) setLoaded(next)
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return
        setLoaded({
          status: 'failed',
          message: isApiError(failure) ? failure.message : 'Could not load the places.',
        })
      })

    return () => {
      controller.abort()
    }
  }, [api, approved, reload])

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

  const ready = loaded.status === 'ready' ? loaded : undefined

  const reorderTo = (ids: string[] | undefined) => {
    if (ids === undefined || ready === undefined) return
    void run(() => api.reorderPlaces(ready.eventId, ids), 'Could not reorder the places.')
  }

  const add = () => {
    if (ready === undefined) return
    if (isBlank(draft)) {
      setError(NEEDS_BOTH)
      return
    }

    void run(async () => {
      await api.addPlace(ready.eventId, {
        name: draft.name.trim(),
        emoji: draft.emoji.trim(),
        color: draft.color,
      })
      setDraft(BLANK)
    }, 'Could not add the place.')
  }

  if (viewer.status === 'loading') {
    return (
      <section class="page">
        <h1>Places</h1>
        <p class="form-note">One moment…</p>
      </section>
    )
  }

  if (!approved) {
    return (
      <section class="page">
        <h1>Places</h1>
        {viewer.status === 'signed-out' ? (
          <p>This is for members. Sign in and it will be here.</p>
        ) : (
          // Signed in without a role — an applicant checking on their application.
          // Telling them to sign in would be advice they have already taken.
          <p>This is for members. Ask someone who already has a role.</p>
        )}
      </section>
    )
  }

  const places = ready?.places ?? []
  const ids = places.map((row) => row.id)

  return (
    <section class="page">
      <h1>Places</h1>

      <p class="form-note">
        Somewhere a dream can happen. The emoji and the colour are how a lane is recognised at a glance in the
        schedule, so give each one of its own.
      </p>

      {error !== undefined && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}

      <Notice loaded={loaded} />

      {ready !== undefined && places.length === 0 && ready.sources.length > 0 && (
        <CopyFrom
          sources={ready.sources}
          busy={busy}
          onCopy={(fromEventId) =>
            void run(() => api.copyPlaces(ready.eventId, fromEventId), 'Could not copy those places.')
          }
        />
      )}

      <ol class="place-list">
        {places.map((row, index) => (
          <li
            key={row.id}
            class={dragging === index ? 'place-row place-dragging' : 'place-row'}
            onDragOver={(dragEvent) => {
              // Without this the drop never fires — the default is "not a drop
              // target".
              dragEvent.preventDefault()
            }}
            onDrop={(dropEvent) => {
              dropEvent.preventDefault()
              if (dragging !== undefined) reorderTo(moveTo(ids, dragging, index))
              setDragging(undefined)
            }}
          >
            <button
              type="button"
              class="drag-handle"
              draggable
              disabled={busy}
              aria-label={`Move ${row.name}`}
              onDragStart={(dragEvent) => {
                // Firefox will not start a drag whose data store is empty.
                dragEvent.dataTransfer?.setData('text/plain', row.id)
                setDragging(index)
              }}
              onDragEnd={() => setDragging(undefined)}
              onKeyDown={(keyEvent) => {
                // The handle is the keyboard route too. Dragging is a pointer
                // gesture, and a reorder nobody can do without a mouse is a
                // reorder half the people here cannot do.
                const by = keyEvent.key === 'ArrowUp' ? -1 : keyEvent.key === 'ArrowDown' ? 1 : undefined
                if (by === undefined) return
                keyEvent.preventDefault()
                reorderTo(swap(ids, index, by))
              }}
            >
              ⠿
            </button>

            {editing === row.id ? (
              <PlaceFields
                place={row}
                busy={busy}
                onCancel={() => setEditing(undefined)}
                onSave={(changes) => {
                  // The same rule as adding, and the same message. Without it a
                  // cleared field reaches the server and comes back as a bare
                  // "Request failed (400)".
                  if (isBlank(changes)) {
                    setError(NEEDS_BOTH)
                    return
                  }

                  void run(async () => {
                    await api.updatePlace(row.id, changes)
                    setEditing(undefined)
                  }, 'Could not save the place.')
                }}
              />
            ) : (
              <>
                <span class="place-emoji" aria-hidden="true">
                  {row.emoji}
                </span>
                <span class={`place-swatch place-${row.color}`} aria-hidden="true" />
                <span class="place-name">{row.name}</span>
                <span class="place-color-name">{row.color}</span>

                <button
                  type="button"
                  class="link-button"
                  disabled={busy}
                  aria-label={`Edit ${row.name}`}
                  onClick={() => setEditing(row.id)}
                >
                  ✏️
                </button>
                <button
                  type="button"
                  class="link-button"
                  disabled={busy}
                  aria-label={`Remove ${row.name}`}
                  onClick={() => void run(() => api.deletePlace(row.id), 'Could not remove the place.')}
                >
                  🗑️
                </button>
              </>
            )}
          </li>
        ))}
      </ol>

      {/* Only once the burn is known: the lane belongs to one, so a form rendered
          before then would take a name and have nowhere to put it. */}
      {ready !== undefined && (
        <form
          class="form"
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault()
            add()
          }}
        >
          <h2>Add a place</h2>

          <label class="field">
            <span>Name</span>
            <input
              type="text"
              name="name"
              maxLength={MAX_PLACE_NAME}
              aria-required
              value={draft.name}
              onInput={(inputEvent) => setDraft({ ...draft, name: inputEvent.currentTarget.value })}
            />
          </label>

          <label class="field">
            <span>Emoji</span>
            <input
              type="text"
              name="emoji"
              maxLength={MAX_EMOJI}
              aria-required
              value={draft.emoji}
              onInput={(inputEvent) => setDraft({ ...draft, emoji: inputEvent.currentTarget.value })}
            />
          </label>

          <ColorField
            value={draft.color}
            onChange={(color) => setDraft({ ...draft, color })}
            label="Colour"
          />

          <button type="submit" disabled={busy}>
            Add
          </button>
        </form>
      )}
    </section>
  )
}

const ColorField = ({
  value,
  onChange,
  label,
}: {
  value: PlaceColor
  onChange: (color: PlaceColor) => void
  label: string
}) => (
  <label class="field">
    <span>{label}</span>
    <select
      name="color"
      value={value}
      onChange={(changeEvent) => {
        const picked = placeColors.find((color) => color === changeEvent.currentTarget.value)
        if (picked !== undefined) onChange(picked)
      }}
    >
      {placeColors.map((color) => (
        <option key={color} value={color}>
          {color}
        </option>
      ))}
    </select>
  </label>
)

const PlaceFields = ({
  place,
  busy,
  onSave,
  onCancel,
}: {
  place: Place
  busy: boolean
  onSave: (changes: { name: string; emoji: string; color: PlaceColor }) => void
  onCancel: () => void
}) => {
  const [name, setName] = useState(place.name)
  const [emoji, setEmoji] = useState(place.emoji)
  const [color, setColor] = useState<PlaceColor>(place.color)

  return (
    <div class="place-edit">
      <label class="field">
        <span>Name</span>
        <input
          type="text"
          maxLength={MAX_PLACE_NAME}
          aria-label={`Name of ${place.name}`}
          value={name}
          onInput={(inputEvent) => setName(inputEvent.currentTarget.value)}
        />
      </label>

      <label class="field">
        <span>Emoji</span>
        <input
          type="text"
          maxLength={MAX_EMOJI}
          aria-label={`Emoji for ${place.name}`}
          value={emoji}
          onInput={(inputEvent) => setEmoji(inputEvent.currentTarget.value)}
        />
      </label>

      <ColorField value={color} onChange={setColor} label={`Colour of ${place.name}`} />

      <button
        type="button"
        disabled={busy}
        onClick={() => onSave({ name: name.trim(), emoji: emoji.trim(), color })}
      >
        Save
      </button>
      <button type="button" class="link-button" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}

const Notice = ({ loaded }: { loaded: Loaded }) => {
  if (loaded.status === 'loading') return <p class="form-note">Loading…</p>
  if (loaded.status === 'no-burn') {
    return <p class="form-note">There is no burn coming up yet, so there is no grid to lay out.</p>
  }
  if (loaded.status === 'failed') {
    return (
      <p class="form-error" role="alert">
        {loaded.message}
      </p>
    )
  }

  return loaded.places.length === 0 ? (
    <p class="form-note">No places yet. A dream cannot be scheduled until there is somewhere to put it.</p>
  ) : null
}

/**
 * Seed this burn's grid from a previous burn's.
 *
 * Offered only while the grid is empty, because the API refuses a copy into a grid
 * that has lanes — merging two grids is a decision nobody asked for.
 */
const CopyFrom = ({
  sources,
  busy,
  onCopy,
}: {
  sources: readonly Source[]
  busy: boolean
  onCopy: (fromEventId: string) => void
}) => {
  const [chosen, setChosen] = useState(sources[0]?.event_id ?? '')

  return (
    <div class="copy-from">
      <label class="field">
        <span>Or start from a previous burn</span>
        <select
          aria-label="Burn to copy places from"
          disabled={busy}
          value={chosen}
          onChange={(changeEvent) => setChosen(changeEvent.currentTarget.value)}
        >
          {sources.map((source) => (
            <option key={source.event_id} value={source.event_id}>
              {source.name} ({source.count})
            </option>
          ))}
        </select>
      </label>

      <button type="button" disabled={busy || chosen === ''} onClick={() => onCopy(chosen)}>
        Copy those places
      </button>

      <p class="form-note">The lanes, not the dreams standing in them.</p>
    </div>
  )
}
