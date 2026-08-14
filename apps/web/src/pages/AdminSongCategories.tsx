import type { SongCategory } from '@sage-burner/shared'

import { MAX_OPTION_LABEL, songbookPage } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { Destroy } from '../components/Destroy.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { IconButton } from '../components/IconButton.tsx'
import { ReorderableList } from '../components/ReorderableList.tsx'
import { useAction, useLoad } from '../load.ts'

export type SongCategoriesApi = Pick<
  ApiClient,
  | 'getSongCategories'
  | 'addSongCategory'
  | 'updateSongCategory'
  | 'deleteSongCategory'
  | 'reorderSongCategories'
>

export const AdminSongCategories = ({ api }: { api: SongCategoriesApi }) => {
  const { loaded, reload } = useLoad(async (signal) => await api.getSongCategories(signal), {
    fallback: 'Could not load the list. Please reload the page.',
  })
  const { busy, error, run } = useAction(reload)
  const [label, setLabel] = useState('')
  const [editing, setEditing] = useState<string | undefined>(undefined)
  const [draft, setDraft] = useState('')

  const categories: readonly SongCategory[] = loaded.status === 'ready' ? loaded.data.categories : []

  return (
    <GuardedPage title="Song categories" require="admin">
      <h1>Song categories</h1>

      <p class="form-note">
        What a song in the <a href={songbookPage()}>songbook</a> can be filed under. A song can be under
        several, or none. Taking one off the list unfiles the songs in it rather than removing them.
      </p>

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}
      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      <ErrorText message={error} />

      {loaded.status === 'ready' && (
        <>
          <ReorderableList
            rows={categories}
            busy={busy}
            labelFor={(category) => category.label}
            onReorder={(wanted) =>
              run(() => api.reorderSongCategories(wanted), 'Could not reorder the list.')
            }
          >
            {(category) =>
              editing === category.id ? (
                <>
                  <input
                    type="text"
                    maxLength={MAX_OPTION_LABEL}
                    aria-label={`Rename ${category.label}`}
                    value={draft}
                    onInput={(typed) => setDraft(typed.currentTarget.value)}
                  />
                  <button
                    type="button"
                    disabled={busy || draft.trim() === ''}
                    onClick={() =>
                      run(async () => {
                        await api.updateSongCategory(category.id, { label: draft.trim() })
                        setEditing(undefined)
                      }, 'Could not rename that.')
                    }
                  >
                    Save
                  </button>
                  <button type="button" class="link-button" onClick={() => setEditing(undefined)}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span class="reorder-name">{category.label}</span>
                  <IconButton
                    icon="edit"
                    label={`Edit ${category.label}`}
                    disabled={busy}
                    onClick={() => {
                      setEditing(category.id)
                      setDraft(category.label)
                    }}
                  />
                  <Destroy
                    what={category.label}
                    busy={busy}
                    onDestroy={() => run(() => api.deleteSongCategory(category.id), 'Could not remove that.')}
                  />
                </>
              )
            }
          </ReorderableList>

          <form
            class="form"
            onSubmit={(submitted) => {
              submitted.preventDefault()
              if (label.trim() === '') return

              run(async () => {
                await api.addSongCategory({ label: label.trim() })
                setLabel('')
              }, 'Could not add that.')
            }}
          >
            <label class="field">
              <span>Add a category</span>
              <input
                type="text"
                maxLength={MAX_OPTION_LABEL}
                value={label}
                onInput={(typed) => setLabel(typed.currentTarget.value)}
              />
            </label>
            <button type="submit" disabled={busy || label.trim() === ''}>
              Add
            </button>
          </form>
        </>
      )}
    </GuardedPage>
  )
}
