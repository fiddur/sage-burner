import type { PantryItem, PantryKind, StockLevel } from '@sage-burner/shared'

import {
  isPantryKind,
  MAX_OPTION_LABEL,
  MAX_UNIT,
  MAX_WHERE,
  pantryKindLabel,
  pantryKinds,
  stockLevelLabel,
  stockLevels,
} from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { Destroy } from '../components/Destroy.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { IconButton } from '../components/IconButton.tsx'
import { PendingButton } from '../components/PendingButton.tsx'
import { Refreshing } from '../components/Refreshing.tsx'
import { localMoment } from '../datetime.ts'
import { errorMessage, useAction, useLoad } from '../load.ts'
import { isAdmin, isApproved, useViewer } from '../viewer.tsx'

export type PantryApi = Pick<
  ApiClient,
  | 'addPantryItem'
  | 'getPantry'
  | 'restorePantryItem'
  | 'setPantryStock'
  | 'updatePantryItem'
  | 'withdrawPantryItem'
>

export type PantryFilter = 'all' | 'not-counted' | PantryKind

export const pantryFilters: readonly { id: PantryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  ...pantryKinds.map((kind) => ({ id: kind, label: pantryKindLabel[kind] })),
  { id: 'not-counted', label: 'Not counted' },
]

export const shownPantry = (
  items: readonly PantryItem[],
  { filter, search }: { filter: PantryFilter; search: string },
): PantryItem[] => {
  const wanted = search.trim().toLowerCase()

  return items.filter((item) => {
    if (item.withdrawn_at !== null) return false
    if (filter === 'not-counted' && item.stock_level !== null) return false
    if (filter !== 'all' && filter !== 'not-counted' && item.kind !== filter) return false

    return wanted === '' || item.name.toLowerCase().includes(wanted)
  })
}

const TAKEN =
  'Something on the list is already called that. Give this one another name, or put the one that was taken off back.'

const nameClash = (fallback: string) => (failure: unknown) =>
  isApiError(failure) && failure.status === 409 ? TAKEN : errorMessage(failure, fallback)

interface PantryDraft {
  kind: PantryKind
  name: string
  unit: string
  where: string
}

const BLANK: PantryDraft = { kind: 'staple', name: '', unit: 'pcs', where: '' }

export const Pantry = ({ api }: { api: PantryApi }) => {
  const viewer = useViewer()
  const admin = isAdmin(viewer)
  const { loaded, refreshing, reload } = useLoad(async (signal) => await api.getPantry(signal), {
    enabled: isApproved(viewer),
    fallback: 'Could not load the pantry.',
    remember: 'pantry',
  })
  const { busy, error, setError, run } = useAction(reload)

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<PantryFilter>('all')
  const [editing, setEditing] = useState<string | undefined>(undefined)
  const [draft, setDraft] = useState(BLANK)

  const items = loaded.status === 'ready' ? loaded.data.items : []
  const shown = shownPantry(items, { filter, search })
  const gone = items.filter((item) => item.withdrawn_at !== null)

  const count = (item: PantryItem, level: null | StockLevel, amount: number | null) => {
    run(
      () => api.setPantryStock(item.id, { amount: level === 'some' ? amount : null, level }),
      'Could not save that count.',
    )
  }

  const put = () => {
    if (draft.name.trim() === '') {
      setError('A thing needs a name before it can go on the list.')
      return
    }

    run(async () => {
      await api.addPantryItem({
        kind: draft.kind,
        name: draft.name.trim(),
        unit: draft.unit.trim() === '' ? 'pcs' : draft.unit.trim(),
        where: draft.where.trim(),
      })
      setDraft(BLANK)
    }, nameClash('Could not add that.'))
  }

  return (
    <GuardedPage title="Pantry" require="approved">
      <h1>
        Pantry <Refreshing on={refreshing} />
      </h1>

      <p class="form-note">
        What the house usually has, where it lives and roughly how much. Counting is everybody’s — a full sack
        is plenty, half a bucket is some, an empty box is out. It belongs to no one burn.
      </p>

      <ErrorText message={error} />

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}
      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      {loaded.status === 'ready' && (
        <>
          <label class="field">
            <span>Find a thing</span>
            <input
              type="search"
              name="search"
              value={search}
              onInput={(typed) => setSearch(typed.currentTarget.value)}
            />
          </label>

          <p class="chip-row" role="group" aria-label="What to show">
            {pantryFilters.map((one) => (
              <button
                key={one.id}
                type="button"
                class={filter === one.id ? 'chip is-on' : 'chip'}
                aria-pressed={filter === one.id}
                onClick={() => setFilter(one.id)}
              >
                {one.label}
              </button>
            ))}
          </p>

          {shown.length === 0 ? (
            <p class="form-note">Nothing here to count.</p>
          ) : (
            <ul class="pantry-list">
              {shown.map((item) => (
                <li key={item.id} class="pantry-row">
                  {editing === item.id ? (
                    <ItemFields
                      item={item}
                      busy={busy}
                      onCancel={() => setEditing(undefined)}
                      onSave={(changes) =>
                        run(async () => {
                          await api.updatePantryItem(item.id, changes)
                          setEditing(undefined)
                        }, nameClash('Could not save that.'))
                      }
                    />
                  ) : (
                    <Row
                      item={item}
                      admin={admin}
                      busy={busy}
                      onCount={(level, amount) => count(item, level, amount)}
                      onEdit={() => setEditing(item.id)}
                      onWithdraw={() =>
                        run(() => api.withdrawPantryItem(item.id), 'Could not take that off.')
                      }
                    />
                  )}
                </li>
              ))}
            </ul>
          )}

          {admin && (
            <form
              class="form"
              onSubmit={(submitted) => {
                submitted.preventDefault()
                put()
              }}
            >
              <h2>Add a thing</h2>

              <label class="field">
                <span>What is it?</span>
                <input
                  type="text"
                  name="name"
                  maxLength={MAX_OPTION_LABEL}
                  value={draft.name}
                  onInput={(typed) => setDraft((held) => ({ ...held, name: typed.currentTarget.value }))}
                />
              </label>

              <label class="field">
                <span>What kind of thing?</span>
                <select
                  name="kind"
                  value={draft.kind}
                  onChange={(chosen) => {
                    const kind = chosen.currentTarget.value
                    if (isPantryKind(kind)) setDraft((held) => ({ ...held, kind }))
                  }}
                >
                  {pantryKinds.map((kind) => (
                    <option key={kind} value={kind}>
                      {pantryKindLabel[kind]}
                    </option>
                  ))}
                </select>
              </label>

              <label class="field">
                <span>Counted in</span>
                <input
                  type="text"
                  name="unit"
                  maxLength={MAX_UNIT}
                  value={draft.unit}
                  onInput={(typed) => setDraft((held) => ({ ...held, unit: typed.currentTarget.value }))}
                />
              </label>

              <label class="field">
                <span>Where it lives</span>
                <input
                  type="text"
                  name="where"
                  maxLength={MAX_WHERE}
                  placeholder="Hallway bucket · cellar I"
                  value={draft.where}
                  onInput={(typed) => setDraft((held) => ({ ...held, where: typed.currentTarget.value }))}
                />
              </label>

              <PendingButton busy={busy} label="Add it" busyLabel="Adding…" type="submit" />
            </form>
          )}

          {admin && gone.length > 0 && (
            <section>
              <h2>Taken off</h2>
              <p class="form-note">
                Nobody counts these any more. The name is still taken, so putting one back beats typing it
                again.
              </p>
              <ul class="pantry-list">
                {gone.map((item) => (
                  <li key={item.id} class="pantry-row is-gone">
                    <span>{item.name}</span>
                    <IconButton
                      icon="restore"
                      label={`Put ${item.name} back on the list`}
                      disabled={busy}
                      onClick={() => run(() => api.restorePantryItem(item.id), 'Could not put that back.')}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </GuardedPage>
  )
}

const countedBy = (item: PantryItem): string | undefined => {
  if (item.counted_at === null) return undefined

  const who = item.counted_by_name ?? 'somebody who has left'

  return `Counted by ${who} · ${localMoment(item.counted_at)}`
}

const Row = ({
  item,
  admin,
  busy,
  onCount,
  onEdit,
  onWithdraw,
}: {
  item: PantryItem
  admin: boolean
  busy: boolean
  onCount: (level: null | StockLevel, amount: number | null) => void
  onEdit: () => void
  onWithdraw: () => void
}) => {
  const said = countedBy(item)

  return (
    <>
      <p class="pantry-what">
        <strong>{item.name}</strong> <span class="pantry-kind">{pantryKindLabel[item.kind]}</span>
      </p>

      {item.where !== '' && <p class="form-note">{item.where}</p>}
      {said !== undefined && <p class="form-note">{said}</p>}

      <p class="stock-choice" role="group" aria-label={`How much ${item.name} is left`}>
        {stockLevels.map((level) => (
          <button
            key={level}
            type="button"
            class={item.stock_level === level ? 'stock-step is-on' : 'stock-step'}
            aria-pressed={item.stock_level === level}
            disabled={busy}
            onClick={() => onCount(item.stock_level === level ? null : level, item.stock_amount)}
          >
            {stockLevelLabel[level]}
          </button>
        ))}

        {item.stock_level === 'some' && (
          <Amount item={item} busy={busy} onAmount={(amount) => onCount('some', amount)} />
        )}
      </p>

      {admin && (
        <p class="pantry-actions">
          <IconButton icon="edit" label={`Edit ${item.name}`} disabled={busy} onClick={onEdit} />
          <Destroy what={item.name} verb="Take off" busy={busy} onDestroy={onWithdraw} />
        </p>
      )}
    </>
  )
}

const Amount = ({
  item,
  busy,
  onAmount,
}: {
  item: PantryItem
  busy: boolean
  onAmount: (amount: number | null) => void
}) => {
  const [typed, setTyped] = useState(item.stock_amount === null ? '' : String(item.stock_amount))

  const save = () => {
    const wanted = typed.trim() === '' ? null : Number(typed)
    if (wanted !== null && (Number.isNaN(wanted) || wanted < 0)) return
    if (wanted === item.stock_amount) return

    onAmount(wanted)
  }

  return (
    <span class="stock-amount">
      <input
        type="number"
        min={0}
        step="any"
        inputMode="decimal"
        aria-label={`How much ${item.name}, in ${item.unit}`}
        disabled={busy}
        value={typed}
        onInput={(entered) => setTyped(entered.currentTarget.value)}
        onBlur={save}
        onKeyDown={(pressed) => {
          if (pressed.key === 'Enter') {
            pressed.preventDefault()
            save()
          }
        }}
      />
      <span>{item.unit}</span>
    </span>
  )
}

const ItemFields = ({
  item,
  busy,
  onCancel,
  onSave,
}: {
  item: PantryItem
  busy: boolean
  onCancel: () => void
  onSave: (changes: PantryDraft) => void
}) => {
  const [held, setHeld] = useState({
    kind: item.kind,
    name: item.name,
    unit: item.unit,
    where: item.where,
  })

  return (
    <div class="pantry-edit">
      <label class="field">
        <span>Name</span>
        <input
          type="text"
          maxLength={MAX_OPTION_LABEL}
          aria-label={`Name, for ${item.name}`}
          value={held.name}
          onInput={(typed) => setHeld((was) => ({ ...was, name: typed.currentTarget.value }))}
        />
      </label>

      <label class="field">
        <span>Kind</span>
        <select
          aria-label={`Kind, for ${item.name}`}
          value={held.kind}
          onChange={(chosen) => {
            const kind = chosen.currentTarget.value
            if (isPantryKind(kind)) setHeld((was) => ({ ...was, kind }))
          }}
        >
          {pantryKinds.map((kind) => (
            <option key={kind} value={kind}>
              {pantryKindLabel[kind]}
            </option>
          ))}
        </select>
      </label>

      <label class="field">
        <span>Counted in</span>
        <input
          type="text"
          maxLength={MAX_UNIT}
          aria-label={`Counted in, for ${item.name}`}
          value={held.unit}
          onInput={(typed) => setHeld((was) => ({ ...was, unit: typed.currentTarget.value }))}
        />
      </label>

      <label class="field">
        <span>Where it lives</span>
        <input
          type="text"
          maxLength={MAX_WHERE}
          aria-label={`Where, for ${item.name}`}
          value={held.where}
          onInput={(typed) => setHeld((was) => ({ ...was, where: typed.currentTarget.value }))}
        />
      </label>

      <p class="row">
        <PendingButton
          busy={busy}
          label="Save"
          busyLabel="Saving…"
          type="button"
          onClick={() =>
            onSave({
              kind: held.kind,
              name: held.name.trim(),
              unit: held.unit.trim(),
              where: held.where.trim(),
            })
          }
        />
        <button type="button" class="link-button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </p>
    </div>
  )
}
