import type { Event, EventOption, EventOptionKind } from '@sage-burner/shared'

import { MAX_OPTION_LABEL } from '@sage-burner/shared'
import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { isAdmin, isApproved, useViewer } from '../viewer.tsx'

export type OptionsApi = Pick<
  ApiClient,
  | 'getActiveEvent'
  | 'getEventOptions'
  | 'addEventOption'
  | 'updateEventOption'
  | 'deleteEventOption'
  | 'reorderEventOptions'
>

type Loaded =
  | { status: 'loading' }
  | { status: 'ready'; event: Event | null; options: readonly EventOption[] }
  | { status: 'failed'; message: string }

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

/** Only lodging runs out; nothing runs short of people willing to tend a sauna. */
const takesCapacity = (kind: EventOptionKind) => kind === 'lodging'

const HEADING: Record<EventOptionKind, string> = {
  lodging: 'Where people can sleep',
  helping: 'What people can help with',
}

const BLURB: Record<EventOptionKind, string> = {
  lodging:
    'A member picks one of these. Give the ones that run out a number of spaces — "Temple mattress: 9" — and leave it blank for the ones that do not, like a tent of their own.',
  helping: 'A member ticks as many as they like, and can write in something you have not thought of.',
}

/**
 * The two lists for the burn that is open.
 *
 * Per event rather than per community, so this page follows the active event the
 * way the roster does. Setting them up before the burn works because "active" is
 * the soonest-ending burn that has not finished.
 */
export const AdminOptions = ({ api }: { api: OptionsApi }) => {
  const viewer = useViewer()
  const approved = isApproved(viewer)
  const admin = isAdmin(viewer)
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (!approved) return undefined

    const controller = new AbortController()

    api
      .getActiveEvent(controller.signal)
      .then(async (active) => {
        if (active.event === null) return { event: null, options: [] as EventOption[] }
        const { options } = await api.getEventOptions(active.event.id, controller.signal)

        return { event: active.event, options }
      })
      .then((next) => {
        if (!controller.signal.aborted) setLoaded({ status: 'ready', ...next })
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return
        setLoaded({
          status: 'failed',
          message: isApiError(failure) ? failure.message : 'Could not load the lists.',
        })
      })

    return () => {
      controller.abort()
    }
  }, [api, approved, reload])

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

  if (viewer.status === 'loading') {
    return (
      <section class="page">
        <h1>Lodging and helping</h1>
        <p class="form-note">One moment…</p>
      </section>
    )
  }

  if (!approved) {
    return (
      <section class="page">
        <h1>Lodging and helping</h1>
        {viewer.status === 'signed-out' ? (
          <p>This is for members. Sign in and it will be here.</p>
        ) : (
          // Signed in without a role — an applicant checking on their application.
          // Telling them to sign in would be advice they have already taken.
          <p>This is for members. Ask someone who already has a role.</p>
        )}
      </section>
    )
  }

  return (
    <section class="page">
      <h1>Lodging and helping</h1>

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

      {loaded.status === 'ready' && loaded.event === null && (
        <p class="notice">
          There is no burn open, and these lists belong to one.{' '}
          {admin ? (
            <>
              Make an event under <a href="/admin/events">Events</a> first.
            </>
          ) : (
            // Creating a burn is admin-only, so a member sent to that page would
            // read "This is an admin page." A dead end is worse than a plain
            // sentence saying who to ask.
            <>Ask someone with admin to create one first.</>
          )}
        </p>
      )}

      {loaded.status === 'ready' && loaded.event !== null && (
        <>
          <p class="form-note">For {loaded.event.name}.</p>

          {(['lodging', 'helping'] as const).map((kind) => (
            <OptionList
              key={kind}
              kind={kind}
              eventId={loaded.event === null ? '' : loaded.event.id}
              options={loaded.options.filter((row) => row.kind === kind)}
              busy={busy}
              api={api}
              run={run}
              setError={setError}
            />
          ))}
        </>
      )}
    </section>
  )
}

const OptionList = ({
  kind,
  eventId,
  options,
  busy,
  api,
  run,
  setError,
}: {
  kind: EventOptionKind
  eventId: string
  options: readonly EventOption[]
  busy: boolean
  api: OptionsApi
  run: (action: () => Promise<unknown>, fallback: string) => Promise<void>
  setError: (message: string) => void
}) => {
  const [label, setLabel] = useState('')
  const [capacity, setCapacity] = useState('')
  const [editing, setEditing] = useState<string | undefined>(undefined)
  const [dragging, setDragging] = useState<number | undefined>(undefined)
  const ids = options.map((row) => row.id)

  const reorderTo = (next: string[] | undefined) => {
    if (next === undefined) return
    void run(() => api.reorderEventOptions(eventId, kind, next), 'Could not reorder that list.')
  }

  const add = () => {
    if (label.trim() === '') {
      setError('Give it a name — this is what a member picks from.')
      return
    }

    const spaces = capacity.trim() === '' ? null : Number(capacity)

    void run(async () => {
      await api.addEventOption(eventId, { kind, label: label.trim(), capacity: spaces })
      setLabel('')
      setCapacity('')
    }, 'Could not add that.')
  }

  return (
    <section class="option-list">
      <h2>{HEADING[kind]}</h2>
      <p class="form-note">{BLURB[kind]}</p>

      {options.length === 0 && <p class="form-note">Nothing here yet.</p>}

      <ol class="place-list">
        {options.map((row, index) => (
          <li
            key={row.id}
            class={dragging === index ? 'place-row place-dragging' : 'place-row'}
            onDragOver={(dragEvent) => dragEvent.preventDefault()}
            onDrop={(dropEvent) => {
              dropEvent.preventDefault()
              if (dragging !== undefined) reorderTo(moveTo(ids, dragging, index))
              setDragging(undefined)
            }}
          >
            <button
              type="button"
              class="drag-handle"
              draggable={!busy}
              disabled={busy}
              aria-label={`Move ${row.label}`}
              onDragStart={(dragEvent) => {
                // Firefox will not start a drag whose data store is empty.
                dragEvent.dataTransfer?.setData('text/plain', row.id)
                setDragging(index)
              }}
              onDragEnd={() => setDragging(undefined)}
              onKeyDown={(keyEvent) => {
                const by = keyEvent.key === 'ArrowUp' ? -1 : keyEvent.key === 'ArrowDown' ? 1 : undefined
                if (by === undefined) return
                keyEvent.preventDefault()
                reorderTo(swap(ids, index, by))
              }}
            >
              ⠿
            </button>

            {editing === row.id ? (
              <OptionFields
                option={row}
                busy={busy}
                onCancel={() => setEditing(undefined)}
                onSave={(changes) => {
                  if (changes.label !== undefined && changes.label === '') {
                    setError('Give it a name — this is what a member picks from.')
                    return
                  }

                  void run(async () => {
                    await api.updateEventOption(row.id, changes)
                    setEditing(undefined)
                  }, 'Could not save that.')
                }}
              />
            ) : (
              <>
                <span class="place-name">{row.label}</span>
                <span class="place-color-name">
                  {row.capacity === null ? 'no limit' : `${row.capacity} spaces`}
                </span>

                <button
                  type="button"
                  class="link-button"
                  disabled={busy}
                  aria-label={`Edit ${row.label}`}
                  onClick={() => setEditing(row.id)}
                >
                  ✏️
                </button>
                <button
                  type="button"
                  class="link-button"
                  disabled={busy}
                  aria-label={`Remove ${row.label}`}
                  onClick={() => void run(() => api.deleteEventOption(row.id), 'Could not remove that.')}
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
        <label class="field">
          <span>Add to this list</span>
          <input
            type="text"
            maxLength={MAX_OPTION_LABEL}
            aria-required
            aria-label={`New ${kind} name`}
            value={label}
            onInput={(inputEvent) => setLabel(inputEvent.currentTarget.value)}
          />
        </label>

        {takesCapacity(kind) && (
          <label class="field">
            <span>Spaces (blank for no limit)</span>
            {/*
              `min` and the implicit whole-number step are the whole check, and
              deliberately so — the browser refuses to submit a form with an
              invalid number, so a JavaScript guard beside them is unreachable
              code. That is the same two-validator trap as `required` versus
              `aria-required` elsewhere here, with the opposite conclusion: for a
              name the page must be the authority, because it has something to
              say; for a count the browser already says it.
            */}
            <input
              type="number"
              min="1"
              aria-label={`New ${kind} spaces`}
              value={capacity}
              onInput={(inputEvent) => setCapacity(inputEvent.currentTarget.value)}
            />
          </label>
        )}

        <button type="submit" disabled={busy}>
          Add
        </button>
      </form>
    </section>
  )
}

const OptionFields = ({
  option,
  busy,
  onSave,
  onCancel,
}: {
  option: EventOption
  busy: boolean
  onSave: (changes: { label?: string; capacity?: number | null }) => void
  onCancel: () => void
}) => {
  const [label, setLabel] = useState(option.label)
  const [capacity, setCapacity] = useState(option.capacity === null ? '' : String(option.capacity))

  return (
    <div class="place-edit">
      <label class="field">
        <span>Name</span>
        <input
          type="text"
          maxLength={MAX_OPTION_LABEL}
          aria-label={`Name of ${option.label}`}
          value={label}
          onInput={(inputEvent) => setLabel(inputEvent.currentTarget.value)}
        />
      </label>

      {takesCapacity(option.kind) && (
        <label class="field">
          <span>Spaces (blank for no limit)</span>
          <input
            type="number"
            min="1"
            aria-label={`Spaces in ${option.label}`}
            value={capacity}
            onInput={(inputEvent) => setCapacity(inputEvent.currentTarget.value)}
          />
        </label>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={() =>
          onSave({
            label: label.trim(),
            ...(takesCapacity(option.kind)
              ? { capacity: capacity.trim() === '' ? null : Number(capacity) }
              : {}),
          })
        }
      >
        Save
      </button>
      <button type="button" class="link-button" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}
