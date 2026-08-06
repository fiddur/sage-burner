import type { Place, Session } from '@sage-burner/shared'

import { MAX_TITLE } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { useSelectedBurn } from '../burn.tsx'
import { DreamFields } from '../components/DreamFields.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { shortDayOf } from '../datetime.ts'
import { useAction, useLoad } from '../load.ts'
import { isMember, useViewer } from '../viewer.tsx'

export type DreamsApi = Pick<
  ApiClient,
  'getSessions' | 'offerSession' | 'updateSession' | 'withdrawSession' | 'getPlaces' | 'getEventAttendees'
>

const placeLabel = (places: readonly Place[], id: string | null) => {
  const found = places.find((row) => row.id === id)

  return found === undefined ? undefined : `${found.emoji} ${found.name}`
}

/** `Sat 14:30`. The weekday is ours and in English; the clock is the browser's. */
const when = (dream: Session) => {
  if (dream.time_slot_start === null) return undefined

  const day = shortDayOf(dream.time_slot_start)
  if (day === undefined) return undefined

  const clock = new Date(dream.time_slot_start).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })

  return `${day} ${clock}`
}

/**
 * Dreams — the workshops, ceremonies and happenings members offer each other.
 *
 * A dream with no time is *offered but not yet scheduled*, which is where most
 * of them sit right up until the burn. Anyone here can arrange the schedule, not
 * only whoever offered a given dream.
 */
export const Dreams = ({ api }: { api: DreamsApi }) => {
  const viewer = useViewer()
  const member = isMember(viewer)
  const [title, setTitle] = useState('')
  const [editing, setEditing] = useState<string | undefined>(undefined)

  // The burn comes first: since #156 the lanes belong to one. With no burn open
  // there is nothing to offer a dream to either, and `getSessions` says so anyway.
  const burn = useSelectedBurn()
  const { loaded, reload } = useLoad(
    async (signal) => {
      if (burn === undefined) return { sessions: [], places: [], attendees: [] }

      const [dreams, places, attendees] = await Promise.all([
        api.getSessions(burn.event.id, signal),
        api.getPlaces(burn.event.id, signal),
        api.getEventAttendees(burn.event.id, signal),
      ])

      return { sessions: dreams.sessions, places: places.places, attendees: attendees.attendees }
    },
    { enabled: member, key: burn?.event.id ?? '', fallback: 'Could not load the dreams.', live: true },
  )

  const { busy, error, setError, run } = useAction(reload)

  const offer = () => {
    if (title.trim() === '') {
      setError('Give your dream a name.')
      return
    }

    run(async () => {
      if (burn === undefined) return
      await api.offerSession(burn.event.id, { title: title.trim(), description: '' })
      setTitle('')
    }, 'Could not offer that.')
  }

  const dreams = loaded.status === 'ready' ? loaded.data.sessions : []
  const places = loaded.status === 'ready' ? loaded.data.places : []
  const attendees = loaded.status === 'ready' ? loaded.data.attendees : []

  return (
    <GuardedPage title="Dreams" require="member">
      <h1>Dreams</h1>

      <p class="form-note">
        Workshops, ceremonies, happenings — whatever you want to offer. Say what it is now and work out when
        later; most dreams have no time until quite close to the burn.
      </p>

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

      {loaded.status === 'ready' && dreams.length === 0 && (
        <p class="form-note">Nobody has offered a dream yet. Yours can be the first.</p>
      )}

      <ol class="dream-list">
        {dreams.map((dream) => (
          <li key={dream.id} class="dream-row">
            {editing === dream.id ? (
              <DreamFields
                dream={dream}
                subject={dream.title}
                places={places}
                attendees={attendees}
                busy={busy}
                onCancel={() => setEditing(undefined)}
                onSave={(changes) =>
                  run(async () => {
                    await api.updateSession(dream.id, changes)
                    setEditing(undefined)
                  }, 'Could not save that.')
                }
              />
            ) : (
              <>
                <span class="dream-title">
                  {dream.title}
                  {dream.repeatable && (
                    <span class="dream-repeats">
                      <span aria-hidden="true">↻</span>
                      <span class="visually-hidden">Can be planned more than once</span>
                    </span>
                  )}
                </span>
                <span class="dream-when">{when(dream) ?? 'not scheduled yet'}</span>
                <span class="dream-place">{placeLabel(places, dream.place_id) ?? '—'}</span>

                <button
                  type="button"
                  class="link-button"
                  disabled={busy}
                  aria-label={`Edit ${dream.title}`}
                  onClick={() => setEditing(dream.id)}
                >
                  ✏️
                </button>
                <button
                  type="button"
                  class="link-button"
                  disabled={busy}
                  aria-label={`Withdraw ${dream.title}`}
                  onClick={() => run(() => api.withdrawSession(dream.id), 'Could not withdraw that.')}
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
          offer()
        }}
      >
        <h2>Offer a dream</h2>

        <label class="field">
          <span>What is it?</span>
          <input
            type="text"
            name="title"
            maxLength={MAX_TITLE}
            aria-required
            value={title}
            onInput={(inputEvent) => setTitle(inputEvent.currentTarget.value)}
          />
        </label>

        <button type="submit" disabled={busy}>
          Offer it
        </button>
      </form>
    </GuardedPage>
  )
}
