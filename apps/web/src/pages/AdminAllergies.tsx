import type { AllergyItem } from '@sage-burner/shared'

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

export type AllergiesApi = Pick<
  ApiClient,
  'getAllergyItems' | 'addAllergyItem' | 'updateAllergyItem' | 'deleteAllergyItem' | 'reorderAllergyItems'
>

export const AdminAllergies = ({ api }: { api: AllergiesApi }) => {
  const { loaded, reload } = useLoad(async (signal) => await api.getAllergyItems(signal), {
    fallback: 'Could not load the list. Please reload the page.',
  })
  const { busy, error, run } = useAction(reload)
  const [label, setLabel] = useState('')
  const [editing, setEditing] = useState<string | undefined>(undefined)
  const [draft, setDraft] = useState('')

  const items: readonly AllergyItem[] = loaded.status === 'ready' ? loaded.data.items : []

  const add = () => {
    if (label.trim() === '') return

    run(async () => {
      await api.addAllergyItem({ label: label.trim() })
      setLabel('')
    }, 'Could not add that.')
  }

  const rename = (id: string) => {
    if (draft.trim() === '') return

    run(async () => {
      await api.updateAllergyItem(id, { label: draft.trim() })
      setEditing(undefined)
    }, 'Could not rename that.')
  }

  const remove = (item: AllergyItem) => {
    run(
      async () => await api.deleteAllergyItem(item.id),
      (failure) =>
        isApiError(failure) && failure.status === 409
          ? `Somebody has ticked “${item.label}”, so it cannot be removed. Rename it instead.`
          : 'Could not remove that.',
    )
  }

  return (
    <GuardedPage title="Allergy list" require="admin">
      <h1>Allergy list</h1>

      <p class="form-note">
        What members can tick on their own page. Everybody keeps a free-text box beside it, because a list is
        never complete. Renaming one changes what everybody who ticked it is shown as having said.
      </p>

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}

      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      <ErrorText message={error} />

      {loaded.status === 'ready' && (
        <>
          <ReorderableList
            rows={items}
            busy={busy}
            labelFor={(item) => item.label}
            onReorder={(wanted) => run(() => api.reorderAllergyItems(wanted), 'Could not reorder the list.')}
          >
            {(item) => (
              <>
                {editing === item.id ? (
                  <>
                    <input
                      type="text"
                      maxLength={MAX_OPTION_LABEL}
                      aria-label={`Rename ${item.label}`}
                      value={draft}
                      onInput={(typed) => setDraft(typed.currentTarget.value)}
                    />
                    <button type="button" disabled={busy} onClick={() => rename(item.id)}>
                      Save
                    </button>
                    <button type="button" class="link-button" onClick={() => setEditing(undefined)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span class="reorder-name">{item.label}</span>
                    <IconButton
                      icon="✏️"
                      label={`Edit ${item.label}`}
                      disabled={busy}
                      onClick={() => {
                        setEditing(item.id)
                        setDraft(item.label)
                      }}
                    />
                    <Destroy what={item.label} busy={busy} onDestroy={() => remove(item)} />
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
              <span>Add an item</span>
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
