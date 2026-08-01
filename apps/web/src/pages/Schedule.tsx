import type { Event, Place, Session } from '@sage-burner/shared'
import type { ComponentChildren } from 'preact'

import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { fromLocalInput } from '../datetime.ts'
import { dayAfter, endFor, hourOf, hoursOf } from '../schedule.ts'
import { isMember, useViewer } from '../viewer.tsx'

export type ScheduleApi = Pick<ApiClient, 'getSessions' | 'getPlaces' | 'getActiveEvent' | 'updateSession'>

type Loaded =
  | { status: 'loading' }
  | { status: 'ready'; event: Event | null; places: readonly Place[]; sessions: readonly Session[] }
  | { status: 'failed'; message: string }

const label = (row: string) => row.slice(11)

const dayOf = (row: string) => row.slice(0, 10)

/**
 * The timetable: places across, hours down, and the dreams nobody has placed yet
 * beside it.
 *
 * Dragging is the whole point of the page, and it is also the one interaction a
 * unit test cannot really have — `fireEvent.drop` exercises these handlers, not a
 * browser's drag. The Dreams page keeps the precise route: a form with a place
 * and two datetime fields, reachable by keyboard, which is what anyone who cannot
 * drag should use.
 */
export const Schedule = ({ api }: { api: ScheduleApi }) => {
  const viewer = useViewer()
  const member = isMember(viewer)
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [dragged, setDragged] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (!member) return undefined

    const controller = new AbortController()

    Promise.all([
      api.getActiveEvent(controller.signal),
      api.getPlaces(controller.signal),
      api.getSessions(controller.signal),
    ])
      .then(([active, places, dreams]) => {
        if (controller.signal.aborted) return
        setLoaded({
          status: 'ready',
          event: active.event,
          places: places.places,
          sessions: dreams.sessions,
        })
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return
        setLoaded({
          status: 'failed',
          message: isApiError(failure) ? failure.message : 'Could not load the schedule.',
        })
      })

    return () => {
      controller.abort()
    }
  }, [api, member, reload])

  const move = (id: string, changes: Parameters<ScheduleApi['updateSession']>[1]) => {
    setError(undefined)
    setBusy(true)
    api
      .updateSession(id, changes)
      .then(() => setReload((count) => count + 1))
      .catch((failure: unknown) => {
        setError(isApiError(failure) ? failure.message : 'Could not move that dream.')
      })
      .finally(() => setBusy(false))
  }

  if (viewer.status === 'loading') return <Framed>{<p class="form-note">One moment…</p>}</Framed>

  if (!member) {
    return (
      <Framed>
        <p>
          This is for members. <a href="/login">Log in</a> to see it.
        </p>
      </Framed>
    )
  }

  if (loaded.status === 'loading') return <Framed>{<p class="form-note">Loading…</p>}</Framed>

  if (loaded.status === 'failed') {
    return (
      <Framed>
        <p class="form-error" role="alert">
          {loaded.message}
        </p>
      </Framed>
    )
  }

  const { event, places, sessions } = loaded

  if (event === null) {
    return (
      <Framed>
        <p class="notice">There is no burn scheduled at the moment. Check back later.</p>
      </Framed>
    )
  }

  if (places.length === 0) {
    return (
      <Framed>
        <p class="notice">
          No places yet, so there are no lanes to put anything in. An organiser adds them under{' '}
          <a href="/admin/places">Places</a>.
        </p>
      </Framed>
    )
  }

  const rows = hoursOf(event.start_date, dayAfter(event.end_date))

  // The pool holds whatever the grid does not draw, rather than a guess at which
  // dreams those are. Missing a time or a place is the common case; a dream timed
  // outside these days is the one that used to render nowhere at all.
  const drawn = new Set(
    sessions
      .filter((dream) => dream.place_id !== null && rows.includes(hourOf(dream.time_slot_start) ?? ''))
      .map((dream) => dream.id),
  )
  const unscheduled = sessions.filter((dream) => !drawn.has(dream.id))

  const dropInto = (row: string, placeId: string) => {
    const dream = sessions.find((candidate) => candidate.id === dragged)
    if (dream === undefined) return

    // Keeps whatever length it already had. Forcing an hour would quietly
    // shorten a two-hour session just because someone moved it to another lane.
    move(dream.id, {
      place_id: placeId,
      time_slot_start: fromLocalInput(row),
      time_slot_end: endFor(row, dream),
    })
    setDragged(undefined)
  }

  return (
    <Framed>
      {error !== undefined && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}

      <div class="schedule">
        <Pool
          dreams={unscheduled}
          busy={busy}
          onDragStart={setDragged}
          onDrop={() => {
            // Back to the pool is how a dream gets unscheduled.
            if (dragged === undefined) return
            move(dragged, { place_id: null, time_slot_start: null, time_slot_end: null })
            setDragged(undefined)
          }}
        />

        <Timetable
          rows={rows}
          places={places}
          dreams={sessions}
          busy={busy}
          onDragStart={setDragged}
          onDrop={dropInto}
        />
      </div>
    </Framed>
  )
}

const Framed = ({ children }: { children: ComponentChildren }) => (
  <section class="page schedule-page">
    <h1>Schedule</h1>
    {children}
  </section>
)

const Chip = ({
  dream,
  busy,
  onDragStart,
}: {
  dream: Session
  busy: boolean
  onDragStart: (id: string) => void
}) => (
  <span
    class="dream-chip"
    draggable={!busy}
    aria-label={`Move ${dream.title}`}
    onDragStart={() => onDragStart(dream.id)}
  >
    {dream.title}
  </span>
)

const Pool = ({
  dreams,
  busy,
  onDragStart,
  onDrop,
}: {
  dreams: readonly Session[]
  busy: boolean
  onDragStart: (id: string) => void
  onDrop: () => void
}) => (
  <aside
    class="dream-pool"
    onDragOver={(dragEvent) => dragEvent.preventDefault()}
    onDrop={(dropEvent) => {
      dropEvent.preventDefault()
      onDrop()
    }}
  >
    <h2>Not placed yet</h2>

    {dreams.length === 0 && <p class="form-note">Everything has somewhere to be.</p>}

    {dreams.map((dream) => (
      <p key={dream.id}>
        <Chip dream={dream} busy={busy} onDragStart={onDragStart} />
      </p>
    ))}

    <p class="form-note">
      Drag one into the grid to place it, or set the time and place precisely on <a href="/dreams">Dreams</a>.
    </p>
  </aside>
)

const Timetable = ({
  rows,
  places,
  dreams,
  busy,
  onDragStart,
  onDrop,
}: {
  rows: readonly string[]
  places: readonly Place[]
  dreams: readonly Session[]
  busy: boolean
  onDragStart: (id: string) => void
  onDrop: (row: string, placeId: string) => void
}) => (
  <div class="schedule-grid-wrap">
    <table class="schedule-grid">
      <thead>
        <tr>
          <th scope="col">Time</th>
          {places.map((place) => (
            <th key={place.id} scope="col">
              <span aria-hidden="true">{place.emoji}</span> {place.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row} class={label(row) === '00:00' ? 'schedule-daybreak' : undefined}>
            <th scope="row">{label(row) === '00:00' ? `${dayOf(row)} 00:00` : label(row)}</th>
            {places.map((place) => (
              <td
                key={place.id}
                class={`schedule-cell place-${place.color}`}
                onDragOver={(dragEvent) => dragEvent.preventDefault()}
                onDrop={(dropEvent) => {
                  dropEvent.preventDefault()
                  onDrop(row, place.id)
                }}
              >
                {dreams
                  .filter((dream) => dream.place_id === place.id && hourOf(dream.time_slot_start) === row)
                  .map((dream) => (
                    <Chip key={dream.id} dream={dream} busy={busy} onDragStart={onDragStart} />
                  ))}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)
