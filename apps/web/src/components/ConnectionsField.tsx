import type { Connection, ConnectionKind } from '@sage-burner/shared'

import {
  connectionKindInfo,
  connectionKinds,
  isConnectionKind,
  isProfileUrl,
  MAX_CONNECTION_LABEL,
  MAX_CONNECTION_VALUE,
  MAX_CONNECTIONS,
} from '@sage-burner/shared'
import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { FormError, useFormError } from './FormError.tsx'
import { ReorderableList } from './ReorderableList.tsx'

export type ConnectionsApi = Pick<
  ApiClient,
  | 'getMyConnections'
  | 'addMyConnection'
  | 'updateMyConnection'
  | 'removeMyConnection'
  | 'reorderMyConnections'
>

/** What a row is called: the network, or the name somebody gave their own link. */
export const nameOf = (row: Pick<Connection, 'kind' | 'label'>): string =>
  connectionKindInfo[row.kind].labelled && row.label.trim() !== ''
    ? row.label.trim()
    : connectionKindInfo[row.kind].label

/**
 * Why a way of being reached could not be saved.
 *
 * The 409 covers two refusals the server tells apart by nothing else, and both are worth
 * their own sentence: the same handle twice, or a list already as long as it may be.
 */
export const messageForFailure = (failure: unknown, held: number): string => {
  if (isApiError(failure) && failure.status === 409) {
    return held >= MAX_CONNECTIONS
      ? `That is as many ways as one account may list. Take one off to add another.`
      : 'You have already listed that one.'
  }
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

/**
 * What the form itself refuses, so a save the API would reject is refused at the keyboard.
 *
 * The same two rules as `connectionCreateSchema`, and `isProfileUrl` is the shared
 * function rather than a second regex — a link has to be somewhere a browser should be
 * sent, and it has to say what it is.
 */
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
  onChange,
}: {
  draft: Draft
  busy: boolean
  /** What the labels say this form is, since a page can hold two of them at once. */
  subject: string
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
          // Guarded rather than cast: the options are built from the vocabulary, so this
          // cannot fail — but a `<select>`'s value is a string as far as the DOM knows.
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

/**
 * The ways somebody says they can be reached, on their own details page (#388).
 *
 * **In the order they put them in**, because the first one is the answer to the question
 * anybody actually has — where do I reach this person — rather than the start of a list of
 * everything they have ever signed up to. The profile page (#389) reads it in that order.
 *
 * Every row here is shown to approved members, and the note says so: this is a list
 * somebody chooses to publish, which is what separates it from the address they sign in
 * with. That one stays out of what other members read.
 */
export const ConnectionsField = ({ api }: { api: ConnectionsApi }) => {
  const [rows, setRows] = useState<Connection[] | undefined>(undefined)
  const [draft, setDraft] = useState<Draft>(BLANK)
  const [editing, setEditing] = useState<{ id: string; draft: Draft } | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useFormError()

  useEffect(() => {
    const controller = new AbortController()

    api
      .getMyConnections(controller.signal)
      .then(({ connections }) => {
        if (!controller.signal.aborted) setRows(connections)
      })
      .catch(() => {
        if (!controller.signal.aborted) setRows([])
      })

    return () => controller.abort()
  }, [api])

  const held = rows?.length ?? 0

  const run = async (work: () => Promise<Connection[]>) => {
    setError(undefined)
    setBusy(true)
    try {
      setRows(await work())
    } catch (failure) {
      setError(messageForFailure(failure, held))
    } finally {
      setBusy(false)
    }
  }

  const reload = async () => (await api.getMyConnections()).connections

  const add = async () => {
    const problem = problemWith(draft)
    if (problem !== undefined) {
      setError(problem)
      return
    }

    await run(async () => {
      await api.addMyConnection({ kind: draft.kind, value: draft.value.trim(), label: draft.label.trim() })
      return await reload()
    })
    setDraft(BLANK)
  }

  const save = async (id: string, wanted: Draft) => {
    const problem = problemWith(wanted)
    if (problem !== undefined) {
      setError(problem)
      return
    }

    await run(async () => {
      await api.updateMyConnection(id, {
        kind: wanted.kind,
        value: wanted.value.trim(),
        label: wanted.label.trim(),
      })
      return await reload()
    })
    setEditing(undefined)
  }

  return (
    <section>
      <h2>How people can reach you</h2>

      <p class="form-note">
        Every member can see these, in the order you put them in — the first is where people will try you. The
        address you sign in with is not shown to anybody; add it here if you want it to be.
      </p>

      {rows === undefined && <p class="form-note">Loading…</p>}

      {rows?.length === 0 && <p class="form-note">You have not added any yet.</p>}

      {rows !== undefined && rows.length > 0 && (
        <ReorderableList
          rows={rows}
          busy={busy}
          rowClass="connection-row"
          labelFor={(row) => nameOf(row)}
          onReorder={(ids) => void run(async () => (await api.reorderMyConnections(ids)).connections)}
        >
          {(row) =>
            editing?.id === row.id ? (
              <div class="connection-edit">
                <Fields
                  draft={editing.draft}
                  busy={busy}
                  subject={nameOf(row)}
                  onChange={(next) => setEditing({ id: row.id, draft: next })}
                />
                <p class="row">
                  <button type="button" disabled={busy} onClick={() => void save(row.id, editing.draft)}>
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
                <span>
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
                  onClick={() =>
                    void run(async () => {
                      await api.removeMyConnection(row.id)
                      return await reload()
                    })
                  }
                >
                  Remove
                </button>
              </>
            )
          }
        </ReorderableList>
      )}

      <FormError error={error} />

      {held < MAX_CONNECTIONS && (
        <form
          class="form"
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault()
            void add()
          }}
        >
          <Fields draft={draft} busy={busy} subject="a new way to reach you" onChange={setDraft} />
          <button type="submit" disabled={busy}>
            Add it
          </button>
        </form>
      )}
    </section>
  )
}
