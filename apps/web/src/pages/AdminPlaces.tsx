import type { Place, PlaceColor } from '@sage-burner/shared'

import { placeColors } from '@sage-burner/shared'
import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { isAdmin, useViewer } from '../viewer.tsx'

export type PlacesApi = Pick<
  ApiClient,
  'getPlaces' | 'addPlace' | 'updatePlace' | 'deletePlace' | 'reorderPlaces'
>

type Loaded =
  | { status: 'loading' }
  | { status: 'ready'; places: readonly Place[] }
  | { status: 'failed'; message: string }

interface Draft {
  name: string
  emoji: string
  color: PlaceColor
}

const BLANK: Draft = { name: '', emoji: '', color: 'blue' }

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
 * Where a dream can happen.
 *
 * The role check decides what to render, not what is allowed:
 * `/api/admin/places` refuses a non-admin whatever this does.
 */
export const AdminPlaces = ({ api }: { api: PlacesApi }) => {
  const viewer = useViewer()
  const admin = isAdmin(viewer)
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [draft, setDraft] = useState<Draft>(BLANK)
  const [editing, setEditing] = useState<string | undefined>(undefined)
  const [dragging, setDragging] = useState<number | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (!admin) return undefined

    const controller = new AbortController()

    api
      .getPlaces(controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setLoaded({ status: 'ready', places: response.places })
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
  }, [api, admin, reload])

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

  const reorderTo = (places: readonly Place[], ids: string[] | undefined) => {
    if (ids === undefined) return
    void run(() => api.reorderPlaces(ids), 'Could not reorder the places.')
  }

  const add = () => {
    if (draft.name.trim() === '' || draft.emoji.trim() === '') {
      setError('A place needs a name and an emoji — both show in the schedule.')
      return
    }

    void run(async () => {
      await api.addPlace({ name: draft.name.trim(), emoji: draft.emoji.trim(), color: draft.color })
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

  if (!admin) {
    return (
      <section class="page">
        <h1>Places</h1>
        <p>This area is for organisers. If that should be you, ask an existing organiser.</p>
      </section>
    )
  }

  const places = loaded.status === 'ready' ? loaded.places : []
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

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}

      {loaded.status === 'failed' && (
        <p class="form-error" role="alert">
          {loaded.message}
        </p>
      )}

      {loaded.status === 'ready' && places.length === 0 && (
        <p class="form-note">
          No places yet. A dream cannot be scheduled until there is somewhere to put it.
        </p>
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
              if (dragging !== undefined) reorderTo(places, moveTo(ids, dragging, index))
              setDragging(undefined)
            }}
          >
            <button
              type="button"
              class="drag-handle"
              draggable
              disabled={busy}
              aria-label={`Move ${row.name}`}
              onDragStart={() => setDragging(index)}
              onDragEnd={() => setDragging(undefined)}
              onKeyDown={(keyEvent) => {
                // The handle is the keyboard route too. Dragging is a pointer
                // gesture, and a reorder nobody can do without a mouse is a
                // reorder half the people here cannot do.
                const by = keyEvent.key === 'ArrowUp' ? -1 : keyEvent.key === 'ArrowDown' ? 1 : undefined
                if (by === undefined) return
                keyEvent.preventDefault()
                reorderTo(places, swap(ids, index, by))
              }}
            >
              ⠿
            </button>

            {editing === row.id ? (
              <PlaceFields
                place={row}
                busy={busy}
                onCancel={() => setEditing(undefined)}
                onSave={(changes) =>
                  void run(async () => {
                    await api.updatePlace(row.id, changes)
                    setEditing(undefined)
                  }, 'Could not save the place.')
                }
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
            maxLength={100}
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
            maxLength={16}
            aria-required
            value={draft.emoji}
            onInput={(inputEvent) => setDraft({ ...draft, emoji: inputEvent.currentTarget.value })}
          />
        </label>

        <ColorField value={draft.color} onChange={(color) => setDraft({ ...draft, color })} label="Colour" />

        <button type="submit" disabled={busy}>
          Add
        </button>
      </form>
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
          maxLength={100}
          aria-label={`Name of ${place.name}`}
          value={name}
          onInput={(inputEvent) => setName(inputEvent.currentTarget.value)}
        />
      </label>

      <label class="field">
        <span>Emoji</span>
        <input
          type="text"
          maxLength={16}
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
