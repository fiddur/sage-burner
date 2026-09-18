import type { PantryItem, PantryPlace } from '@sage-burner/shared'

import { MAX_OPTION_LABEL } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { Destroy } from '../components/Destroy.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { IconButton } from '../components/IconButton.tsx'
import { ReorderableList } from '../components/ReorderableList.tsx'
import { useAction, useLoad } from '../load.ts'

export type PantryPlacesApi = Pick<
  ApiClient,
  | 'addPantryPlace'
  | 'deletePantryPlace'
  | 'getPantry'
  | 'getPantryPlaces'
  | 'reorderPantryPlaces'
  | 'updatePantryPlace'
>

export const thingsIn = (items: readonly PantryItem[], placeId: string): number =>
  items.filter((item) => item.places.some((one) => one.place_id === placeId)).length

const things = (count: number): string => `${count} thing${count === 1 ? '' : 's'}`

const held = (count: number): string =>
  `Rename it instead: ${things(count)} ${count === 1 ? 'is' : 'are'} in it.`

export const AdminPantryPlaces = ({ api }: { api: PantryPlacesApi }) => {
  const { loaded, reload } = useLoad(
    async (signal) => {
      const [places, pantry] = await Promise.all([api.getPantryPlaces(signal), api.getPantry(signal)])

      return { places: places.places, items: pantry.items }
    },
    { fallback: 'Could not load the rooms. Please reload the page.' },
  )
  const { busy, error, run } = useAction(reload)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | undefined>(undefined)
  const [draft, setDraft] = useState('')

  const places: readonly PantryPlace[] = loaded.status === 'ready' ? loaded.data.places : []
  const items: readonly PantryItem[] = loaded.status === 'ready' ? loaded.data.items : []

  const taken = (what: string) => (failure: unknown) =>
    isApiError(failure) && failure.status === 409
      ? `There is already a room called “${what}”.`
      : 'Could not save that.'

  const add = () => {
    if (name.trim() === '') return

    run(async () => {
      await api.addPantryPlace({ name: name.trim() })
      setName('')
    }, taken(name.trim()))
  }

  const rename = (id: string) => {
    if (draft.trim() === '') return

    run(async () => {
      await api.updatePantryPlace(id, { name: draft.trim() })
      setEditing(undefined)
    }, taken(draft.trim()))
  }

  const remove = (place: PantryPlace) => {
    run(
      async () => await api.deletePantryPlace(place.id),
      (failure) =>
        isApiError(failure) && failure.status === 409
          ? `“${place.name}” still holds things. ${held(thingsIn(items, place.id))}`
          : 'Could not remove that.',
    )
  }

  return (
    <GuardedPage title="Pantry places" require="admin">
      <h1>Pantry places</h1>

      <p class="form-note">
        The rooms the pantry is in, in the order somebody walks them. Every thing can be in several, each with
        a box or a shelf of its own. A room something is still in cannot be removed — rename it instead, and
        everything in it follows.
      </p>

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}

      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      <ErrorText message={error} />

      {loaded.status === 'ready' && (
        <>
          <ReorderableList
            rows={places}
            busy={busy}
            labelFor={(place) => place.name}
            onReorder={(wanted) => run(() => api.reorderPantryPlaces(wanted), 'Could not reorder the rooms.')}
          >
            {(place) => (
              <>
                {editing === place.id ? (
                  <>
                    <input
                      type="text"
                      maxLength={MAX_OPTION_LABEL}
                      aria-label={`Rename ${place.name}`}
                      value={draft}
                      onInput={(typed) => setDraft(typed.currentTarget.value)}
                    />
                    <button type="button" disabled={busy} onClick={() => rename(place.id)}>
                      Save
                    </button>
                    <button type="button" class="link-button" onClick={() => setEditing(undefined)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span class="reorder-name">{place.name}</span>
                    <span class="form-note">{things(thingsIn(items, place.id))}</span>
                    <IconButton
                      icon="edit"
                      label={`Edit ${place.name}`}
                      disabled={busy}
                      onClick={() => {
                        setEditing(place.id)
                        setDraft(place.name)
                      }}
                    />
                    <Destroy what={place.name} busy={busy} onDestroy={() => remove(place)} />
                  </>
                )}
              </>
            )}
          </ReorderableList>

          <form
            class="form"
            onSubmit={(submitted) => {
              submitted.preventDefault()
              add()
            }}
          >
            <label class="field">
              <span>Add a room</span>
              <input
                type="text"
                maxLength={MAX_OPTION_LABEL}
                value={name}
                onInput={(typed) => setName(typed.currentTarget.value)}
              />
            </label>
            <button type="submit" disabled={busy || name.trim() === ''}>
              Add
            </button>
          </form>
        </>
      )}
    </GuardedPage>
  )
}
