import type { EventOption, EventOptionKind, MyBurn } from '@sage-burner/shared'

import { MAX_OPTION_LABEL } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { useSelectedBurn } from '../burn.tsx'
import { Destroy } from '../components/Destroy.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { IconButton } from '../components/IconButton.tsx'
import { NoBurn } from '../components/NoBurn.tsx'
import { ReorderableList } from '../components/ReorderableList.tsx'
import { useAction, useLoad } from '../load.ts'
import { isApproved, useViewer } from '../viewer.tsx'

export type OptionsApi = Pick<
  ApiClient,
  'getEventOptions' | 'addEventOption' | 'updateEventOption' | 'deleteEventOption' | 'reorderEventOptions'
>

type Lists = { event: MyBurn['event'] | null; options: readonly EventOption[] }

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

export const Options = ({ api }: { api: OptionsApi }) => {
  const viewer = useViewer()
  const approved = isApproved(viewer)
  const burn = useSelectedBurn()
  const { loaded, reload } = useLoad<Lists>(
    async (signal) => {
      if (burn === undefined) return { event: null, options: [] }
      const { options } = await api.getEventOptions(burn.event.id, signal)

      return { event: burn.event, options }
    },
    { enabled: approved, key: burn?.event.id ?? '', fallback: 'Could not load the lists.' },
  )

  const { busy, error, setError, run } = useAction(reload)

  return (
    <GuardedPage title="Lodging and helping" require="approved">
      <h1>Lodging and helping</h1>

      <ErrorText message={error} />

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}

      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      {loaded.status === 'ready' && loaded.data.event === null && (
        <NoBurn absent="these lists have no burn to belong to" />
      )}

      {loaded.status === 'ready' && loaded.data.event !== null && (
        <>
          <p class="form-note">For {loaded.data.event.name}.</p>

          {(['lodging', 'helping'] as const).map((kind) => (
            <OptionList
              key={kind}
              kind={kind}
              eventId={loaded.data.event === null ? '' : loaded.data.event.id}
              options={loaded.data.options.filter((row) => row.kind === kind)}
              busy={busy}
              api={api}
              run={run}
              setError={setError}
            />
          ))}
        </>
      )}
    </GuardedPage>
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
  run: ReturnType<typeof useAction>['run']
  setError: (message: string) => void
}) => {
  const [label, setLabel] = useState('')
  const [capacity, setCapacity] = useState('')
  const [editing, setEditing] = useState<string | undefined>(undefined)

  const reorderTo = (wanted: string[]) => {
    run(() => api.reorderEventOptions(eventId, kind, wanted), 'Could not reorder that list.')
  }

  const add = () => {
    if (label.trim() === '') {
      setError('Give it a name — this is what a member picks from.')
      return
    }

    const spaces = capacity.trim() === '' ? null : Number(capacity)

    run(async () => {
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

      <ReorderableList rows={options} busy={busy} labelFor={(row) => row.label} onReorder={reorderTo}>
        {(row) => (
          <>
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

                  run(async () => {
                    await api.updateEventOption(row.id, changes)
                    setEditing(undefined)
                  }, 'Could not save that.')
                }}
              />
            ) : (
              <>
                <span class="reorder-name">{row.label}</span>
                <span class="place-color-name">
                  {row.capacity === null ? 'no limit' : `${row.capacity} spaces`}
                </span>

                <IconButton
                  icon="✏️"
                  label={`Edit ${row.label}`}
                  disabled={busy}
                  onClick={() => setEditing(row.id)}
                />
                <Destroy
                  what={row.label}
                  busy={busy}
                  onDestroy={() => run(() => api.deleteEventOption(row.id), 'Could not remove that.')}
                />
              </>
            )}
          </>
        )}
      </ReorderableList>

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
            {/* No JavaScript guard beside `min`: the browser refuses the submit, so it is unreachable. */}
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
