import type { Connection, ConnectionKind } from '@sage-burner/shared'

import {
  connectionKindInfo,
  connectionKinds,
  connectionValue,
  isConnectionKind,
  isProfileUrl,
  MAX_CONNECTION_LABEL,
  MAX_CONNECTION_VALUE,
  MAX_CONNECTIONS,
} from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { useAction, useLoad } from '../load.ts'
import { ErrorText } from './ErrorText.tsx'
import { FormError } from './FormError.tsx'
import { ReorderableList } from './ReorderableList.tsx'

export type ConnectionsApi = Pick<
  ApiClient,
  | 'getMyConnections'
  | 'addMyConnection'
  | 'updateMyConnection'
  | 'removeMyConnection'
  | 'reorderMyConnections'
>

export const nameOf = (row: Pick<Connection, 'kind' | 'label'>): string =>
  connectionKindInfo[row.kind].labelled && row.label.trim() !== ''
    ? row.label.trim()
    : connectionKindInfo[row.kind].label

export const messageForFailure = (failure: unknown): string => {
  if (isApiError(failure) && failure.code === 'list_full') {
    return 'That is as many ways as one account may list. Take one off to add another.'
  }
  if (isApiError(failure) && failure.status === 409) return 'You have already listed that one.'
  if (isApiError(failure) && failure.status === 400) {
    return 'That does not look like something anybody could reach you on. Have another look at it.'
  }

  return isApiError(failure) ? failure.message : 'Could not save that. Please try again.'
}

interface Draft {
  kind: ConnectionKind
  value: string
  label: string
}

const BLANK: Draft = { kind: 'discord', value: '', label: '' }

export const problemWith = (draft: Draft): string | undefined => {
  if (draft.value.trim() === '') return 'Fill in how to reach you first.'
  if (draft.kind !== 'link') return undefined
  if (!isProfileUrl(draft.value)) return 'A link needs to start with https://'
  if (draft.label.trim() === '') return 'Give the link a name, so the list says what it is.'

  return undefined
}

const Fields = ({
  draft,
  busy,
  subject,
  loginAddress,
  onChange,
}: {
  draft: Draft
  busy: boolean
  subject: string
  loginAddress?: string
  onChange: (draft: Draft) => void
}) => (
  <>
    <label class="field">
      <span>Where</span>
      <select
        aria-label={`Kind of ${subject}`}
        disabled={busy}
        value={draft.kind}
        onChange={(changeEvent) => {
          const kind = changeEvent.currentTarget.value
          if (isConnectionKind(kind)) onChange({ ...draft, kind })
        }}
      >
        {connectionKinds.map((kind) => (
          <option key={kind} value={kind}>
            {connectionKindInfo[kind].icon} {connectionKindInfo[kind].label}
          </option>
        ))}
      </select>
    </label>

    <label class="field">
      <span>What</span>
      <input
        type="text"
        aria-label={`Handle for ${subject}`}
        placeholder={connectionKindInfo[draft.kind].hint}
        maxLength={MAX_CONNECTION_VALUE}
        disabled={busy}
        value={draft.value}
        onInput={(inputEvent) => onChange({ ...draft, value: inputEvent.currentTarget.value })}
      />
    </label>

    {draft.kind === 'email' && loginAddress !== undefined && draft.value !== loginAddress && (
      <button
        type="button"
        class="link-button"
        disabled={busy}
        onClick={() => onChange({ ...draft, value: loginAddress })}
      >
        Use my sign-in address
      </button>
    )}

    {connectionKindInfo[draft.kind].labelled && (
      <label class="field">
        <span>Called</span>
        <input
          type="text"
          aria-label={`Name for ${subject}`}
          placeholder="photos, my band…"
          maxLength={MAX_CONNECTION_LABEL}
          disabled={busy}
          value={draft.label}
          onInput={(inputEvent) => onChange({ ...draft, label: inputEvent.currentTarget.value })}
        />
      </label>
    )}
  </>
)

export const ConnectionsField = ({ api, loginAddress }: { api: ConnectionsApi; loginAddress?: string }) => {
  const [draft, setDraft] = useState<Draft>(BLANK)
  const [editing, setEditing] = useState<{ id: string; draft: Draft } | undefined>(undefined)

  const { loaded, reload } = useLoad(async (signal) => (await api.getMyConnections(signal)).connections, {
    fallback: 'Could not load your ways of being reached. Please reload the page.',
  })
  const rows = loaded.status === 'ready' ? loaded.data : undefined
  const held = rows?.length ?? 0

  const { busy, formError, setError, run } = useAction(reload)

  const add = () => {
    const problem = problemWith(draft)
    if (problem !== undefined) {
      setError(problem)
      return
    }

    run(async () => {
      await api.addMyConnection({
        kind: draft.kind,
        value: connectionValue(draft.kind, draft.value),
        label: draft.label.trim(),
      })
      setDraft(BLANK)
    }, messageForFailure)
  }

  const save = (id: string, wanted: Draft) => {
    const problem = problemWith(wanted)
    if (problem !== undefined) {
      setError(problem)
      return
    }

    run(async () => {
      await api.updateMyConnection(id, {
        kind: wanted.kind,
        value: connectionValue(wanted.kind, wanted.value),
        label: wanted.label.trim(),
      })
      setEditing(undefined)
    }, messageForFailure)
  }

  return (
    <section>
      <h2>How people can reach you</h2>

      <p class="form-note">
        These are how other members will reach you, in the order you put them in — the first is where people
        will try you first. The address you sign in with is shown to nobody; add it here if you want it to be.
      </p>

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}

      {/* Said rather than shown as an empty list: a failed load and "you have added none"
          are different facts, and the wrong one invites an Add that then 409s against rows
          nobody can see. */}
      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      {rows?.length === 0 && <p class="form-note">You have not added any yet.</p>}

      {rows !== undefined && rows.length > 0 && (
        <ReorderableList
          rows={rows}
          busy={busy}
          rowClass="connection-row"
          labelFor={(row) => nameOf(row)}
          onReorder={(ids) => {
            run(async () => {
              await api.reorderMyConnections(ids)
            }, 'Could not save that order. Please try again.')
          }}
        >
          {(row) =>
            editing?.id === row.id ? (
              <div class="connection-edit">
                <Fields
                  draft={editing.draft}
                  busy={busy}
                  subject={nameOf(row)}
                  loginAddress={loginAddress}
                  onChange={(next) => setEditing({ id: row.id, draft: next })}
                />
                <p class="row">
                  <button type="button" disabled={busy} onClick={() => save(row.id, editing.draft)}>
                    Save
                  </button>
                  <button
                    type="button"
                    class="link-button"
                    disabled={busy}
                    onClick={() => setEditing(undefined)}
                  >
                    Cancel
                  </button>
                </p>
              </div>
            ) : (
              <>
                <span aria-hidden="true">{connectionKindInfo[row.kind].icon}</span>
                <span class="connection-what">
                  <strong>{nameOf(row)}</strong> <span class="form-note">{row.value}</span>
                </span>
                <button
                  type="button"
                  class="link-button"
                  disabled={busy}
                  aria-label={`Change ${nameOf(row)}`}
                  onClick={() =>
                    setEditing({ id: row.id, draft: { kind: row.kind, value: row.value, label: row.label } })
                  }
                >
                  Change
                </button>
                <button
                  type="button"
                  class="link-button"
                  disabled={busy}
                  aria-label={`Remove ${nameOf(row)}`}
                  onClick={() => {
                    run(async () => {
                      await api.removeMyConnection(row.id)
                    }, 'Could not remove that. Please try again.')
                  }}
                >
                  Remove
                </button>
              </>
            )
          }
        </ReorderableList>
      )}

      <FormError error={formError} />

      {held < MAX_CONNECTIONS && (
        <form
          class="form"
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault()
            add()
          }}
        >
          <Fields
            draft={draft}
            busy={busy}
            subject="a new way to reach you"
            loginAddress={loginAddress}
            onChange={setDraft}
          />
          <button type="submit" disabled={busy}>
            Add it
          </button>
        </form>
      )}
    </section>
  )
}
