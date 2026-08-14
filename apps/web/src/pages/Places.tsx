import type { Place, PlaceColor } from '@sage-burner/shared'

import { MAX_EMOJI, MAX_PLACE_NAME, placeColors } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { CopySource } from '../components/CopyFrom.tsx'
import type { Loaded } from '../load.ts'

import { useSelectedBurn } from '../burn.tsx'
import { CopyFrom } from '../components/CopyFrom.tsx'
import { Destroy } from '../components/Destroy.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { IconButton } from '../components/IconButton.tsx'
import { NoBurn } from '../components/NoBurn.tsx'
import { ReorderableList } from '../components/ReorderableList.tsx'
import { useAction, useLoad } from '../load.ts'
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

type Grid = { eventId: string; places: readonly Place[]; sources: readonly CopySource[] } | null

interface Draft {
  name: string
  emoji: string
  color: PlaceColor
}

const BLANK: Draft = { name: '', emoji: '', color: 'blue' }

const NEEDS_BOTH = 'A place needs a name and an emoji — both show in the schedule.'

const isBlank = (fields: { name: string; emoji: string }) =>
  fields.name.trim() === '' || fields.emoji.trim() === ''

export const Places = ({ api }: { api: PlacesApi }) => {
  const viewer = useViewer()
  const approved = isApproved(viewer)
  const [draft, setDraft] = useState<Draft>(BLANK)
  const [editing, setEditing] = useState<string | undefined>(undefined)

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

  const reorderTo = (wanted: string[]) => {
    if (ready === undefined) return
    run(() => api.reorderPlaces(ready.eventId, wanted), 'Could not reorder the places.')
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

  return (
    <GuardedPage title="Places" require="approved">
      <h1>Places</h1>

      <p class="form-note">
        Somewhere a dream can happen. The emoji and the colour are how a lane is recognised at a glance in the
        schedule, so give each one of its own.
      </p>

      <ErrorText message={error} />

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

      <ReorderableList rows={places} busy={busy} labelFor={(row) => row.name} onReorder={reorderTo}>
        {(row) => (
          <>
            {editing === row.id ? (
              <PlaceFields
                place={row}
                busy={busy}
                onCancel={() => setEditing(undefined)}
                onSave={(changes) => {
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
                <span class="reorder-name">{row.name}</span>
                <span class="place-color-name">{row.color}</span>

                <IconButton
                  icon="edit"
                  label={`Edit ${row.name}`}
                  disabled={busy}
                  onClick={() => setEditing(row.id)}
                />
                <Destroy
                  what={row.name}
                  busy={busy}
                  onDestroy={() => run(() => api.deletePlace(row.id), 'Could not remove the place.')}
                />
              </>
            )}
          </>
        )}
      </ReorderableList>

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
    return <ErrorText message={loaded.message} />
  }
  if (loaded.data === null) {
    return <NoBurn absent="there is no grid to lay out" />
  }

  return loaded.data.places.length === 0 ? (
    <p class="form-note">No places yet. A dream cannot be scheduled until there is somewhere to put it.</p>
  ) : null
}
