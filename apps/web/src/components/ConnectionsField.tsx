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

/** What a row is called: the network, or the name somebody gave their own link. */
export const nameOf = (row: Pick<Connection, 'kind' | 'label'>): string =>
  connectionKindInfo[row.kind].labelled && row.label.trim() !== ''
    ? row.label.trim()
    : connectionKindInfo[row.kind].label

/**
 * Why a way of being reached could not be saved.
 *
 * The 409 covers two refusals the server tells apart by nothing else, and both are worth
 * their own sentence: the same handle twice, or a list already as long as it may be. Which
 * one it was comes from the caller, because only the add ever answers with the ceiling —
 * inferred from the count instead, editing a row while the list happens to be full would
 * tell somebody to take one off.
 */
export const messageForFailure = (failure: unknown, atCeiling: boolean): string => {
  if (isApiError(failure) && failure.status === 409) {
    return atCeiling
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
  loginAddress,
  onChange,
}: {
  draft: Draft
  busy: boolean
  /** What the labels say this form is, since a page can hold two of them at once. */
  subject: string
  /**
   * The address this account signs in with, for the one-press fill (#388).
   *
   * Passed down rather than fetched: it comes from `getMyProfile`, which the page around
   * this already loads, and `/api/auth/me` deliberately does not carry it. Absent while
   * that load is in flight or failed, which is why the button is conditional.
   */
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

/**
 * The ways somebody says they can be reached, on their own details page (#388).
 *
 * **In the order they put them in**, because the first one is the answer to the question
 * anybody actually has — where do I reach this person — rather than the start of a list of
 * everything they have ever signed up to. The profile page (#389) reads it in that order.
 *
 * Every row here is meant for other members to read, which is what separates the list from
 * the address somebody signs in with: that one stays out of what other members read (#159),
 * and an `email` row is an address the person typed and chose to put up.
 *
 * The note says what the list is *for* rather than who can see it today. Nothing reads
 * somebody else's yet — the page that does is #389 — and people are filling this in now, so
 * the future tense is both true and the safe direction to be wrong in.
 */
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

    run(
      async () => {
        await api.addMyConnection({
          kind: draft.kind,
          // What the server will store, so the row that comes back is what was sent — a
          // pasted profile URL reduces to the handle either way.
          value: connectionValue(draft.kind, draft.value),
          label: draft.label.trim(),
        })
        // Inside the work, so a refusal leaves what was typed where it is (#205).
        setDraft(BLANK)
      },
      (failure) => messageForFailure(failure, held >= MAX_CONNECTIONS),
    )
  }

  const save = (id: string, wanted: Draft) => {
    const problem = problemWith(wanted)
    if (problem !== undefined) {
      setError(problem)
      return
    }

    run(
      async () => {
        await api.updateMyConnection(id, {
          kind: wanted.kind,
          value: connectionValue(wanted.kind, wanted.value),
          label: wanted.label.trim(),
        })
        setEditing(undefined)
      },
      // Never the ceiling: an update's 409 is always a duplicate.
      (failure) => messageForFailure(failure, false),
    )
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
