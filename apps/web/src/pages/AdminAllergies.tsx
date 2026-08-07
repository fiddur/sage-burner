import type { AllergyItem } from '@sage-burner/shared'

import { MAX_OPTION_LABEL } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { useAction, useLoad } from '../load.ts'
import { swap } from '../reorder.ts'

export type AllergiesApi = Pick<
  ApiClient,
  'getAllergyItems' | 'addAllergyItem' | 'updateAllergyItem' | 'deleteAllergyItem' | 'reorderAllergyItems'
>

/**
 * The allergy vocabulary everybody's record is expressed in (#254).
 *
 * Admin's, unlike the burn's lanes and lodging, which any approved member edits:
 * renaming an item rewrites what everybody who ticked it is taken to have said.
 *
 * Removing one somebody has ticked is refused by the database, and the message says
 * what to do instead. That refusal is the point rather than an inconvenience — the
 * alternative is a label going and taking part of somebody's record with it.
 */
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
      // Named rather than generic: a 409 here means somebody's record depends on it,
      // and the useful next step is renaming, not retrying.
      (failure) =>
        isApiError(failure) && failure.status === 409
          ? `Somebody has ticked “${item.label}”, so it cannot be removed. Rename it instead.`
          : 'Could not remove that.',
    )
  }

  // `swap` answers undefined at either end rather than throwing, so the guard is
  // here and the buttons are disabled there — belt and braces, cheaply.
  const move = (index: number, by: -1 | 1) => {
    const ids = swap(
      items.map((one) => one.id),
      index,
      by,
    )
    if (ids === undefined) return

    run(async () => await api.reorderAllergyItems(ids), 'Could not reorder the list.')
  }

  return (
    <GuardedPage title="Allergy list" require="admin">
      <h1>Allergy list</h1>

      <p class="form-note">
        What members can tick on their own page. Everybody keeps a free-text box beside it, because a list is
        never complete. Renaming one changes what everybody who ticked it is shown as having said.
      </p>

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}

      {loaded.status === 'failed' && (
        <p class="form-error" role="alert">
          {loaded.message}
        </p>
      )}

      {error !== undefined && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}

      {loaded.status === 'ready' && (
        <>
          <ul class="reorder-list">
            {items.map((item, index) => (
              <li key={item.id}>
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
                    <span>{item.label}</span>
                    <button
                      type="button"
                      class="link-button"
                      aria-label={`Move ${item.label} up`}
                      disabled={busy || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      class="link-button"
                      aria-label={`Move ${item.label} down`}
                      disabled={busy || index === items.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      class="link-button"
                      aria-label={`Edit ${item.label}`}
                      disabled={busy}
                      onClick={() => {
                        setEditing(item.id)
                        setDraft(item.label)
                      }}
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      class="link-button"
                      aria-label={`Remove ${item.label}`}
                      disabled={busy}
                      onClick={() => remove(item)}
                    >
                      🗑️
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>

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
