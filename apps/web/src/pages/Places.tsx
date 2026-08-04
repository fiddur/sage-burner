import type { CopySourcesResponse, Place, PlaceColor } from '@sage-burner/shared'

import { MAX_EMOJI, MAX_PLACE_NAME, placeColors } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { Loaded } from '../load.ts'

import { useSelectedBurn } from '../burn.tsx'
import { CopyFrom } from '../components/CopyFrom.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { useAction, useLoad } from '../load.ts'
import { moveTo, swap } from '../reorder.ts'
import { isApproved, useViewer } from '../viewer.tsx'

export type PlacesApi = Pick<
  ApiClient,
  | 'getPlaces'
  | 'addPlace'
  | 'updatePlace'
  | 'deletePlace'
  | 'reorderPlaces'
  | 'getPlaceSources'
  | 'copyPlaces'
>

type Source = CopySourcesResponse['sources'][number]

/** Null rather than a fourth status: "no burn is open" is data, not a load outcome. */
type Grid = { eventId: string; places: readonly Place[]; sources: readonly Source[] } | null

interface Draft {
  name: string
  emoji: string
  color: PlaceColor
}

const BLANK: Draft = { name: '', emoji: '', color: 'blue' }

const NEEDS_BOTH = 'A place needs a name and an emoji — both show in the schedule.'

const isBlank = (fields: { name: string; emoji: string }) =>
  fields.name.trim() === '' || fields.emoji.trim() === ''

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
export const Places = ({ api }: { api: PlacesApi }) => {
  const viewer = useViewer()
  const approved = isApproved(viewer)
  const [draft, setDraft] = useState<Draft>(BLANK)
  const [editing, setEditing] = useState<string | undefined>(undefined)
  const [dragging, setDragging] = useState<number | undefined>(undefined)

  const burn = useSelectedBurn()
  const { loaded, reload } = useLoad<Grid>(
    async (signal) => {
      if (burn === undefined) return null

      const eventId = burn.event.id
      const [places, sources] = await Promise.all([
        api.getPlaces(eventId, signal),
        api.getPlaceSources(eventId, signal),
      ])

      return { eventId, places: places.places, sources: sources.sources }
    },
    { enabled: approved, key: burn?.event.id ?? '', fallback: 'Could not load the places.' },
  )

  const { busy, error, setError, run } = useAction(reload)

  const ready = loaded.status === 'ready' ? (loaded.data ?? undefined) : undefined

  const reorderTo = (ids: string[] | undefined) => {
    if (ids === undefined || ready === undefined) return
    run(() => api.reorderPlaces(ready.eventId, ids), 'Could not reorder the places.')
  }

  const add = () => {
    if (ready === undefined) return
    if (isBlank(draft)) {
      setError(NEEDS_BOTH)
      return
    }

    run(async () => {
      await api.addPlace(ready.eventId, {
        name: draft.name.trim(),
        emoji: draft.emoji.trim(),
        color: draft.color,
      })
      setDraft(BLANK)
    }, 'Could not add the place.')
  }

  const places = ready?.places ?? []
  const ids = places.map((row) => row.id)

  return (
    <GuardedPage title="Places" require="approved">
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
          what="places"
          note="The lanes, not the dreams standing in them."
          busy={busy}
          onCopy={(fromEventId) =>
            run(() => api.copyPlaces(ready.eventId, fromEventId), 'Could not copy those places.')
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

                  run(async () => {
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
                  onClick={() => run(() => api.deletePlace(row.id), 'Could not remove the place.')}
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
    </GuardedPage>
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

const Notice = ({ loaded }: { loaded: Loaded<Grid> }) => {
  if (loaded.status === 'loading') return <p class="form-note">Loading…</p>
  if (loaded.status === 'failed') {
    return (
      <p class="form-error" role="alert">
        {loaded.message}
      </p>
    )
  }
  if (loaded.data === null) {
    return <p class="form-note">There is no burn coming up yet, so there is no grid to lay out.</p>
  }

  return loaded.data.places.length === 0 ? (
    <p class="form-note">No places yet. A dream cannot be scheduled until there is somewhere to put it.</p>
  ) : null
}
