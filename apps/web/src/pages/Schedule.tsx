import type { Event, Place, Session } from '@sage-burner/shared'
import type { ComponentChildren } from 'preact'

import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { fromLocalInput, toLocalInput } from '../datetime.ts'
import { useAction, useLoad } from '../load.ts'
import { endFor, hourOf, hoursOf, laneCells } from '../schedule.ts'
import { isMember, useViewer } from '../viewer.tsx'

export type ScheduleApi = Pick<ApiClient, 'getSessions' | 'getPlaces' | 'getActiveEvent' | 'updateSession'>

type Timetable = { event: Event | null; places: readonly Place[]; sessions: readonly Session[] }

const label = (row: string) => row.slice(11)

/** `18:00–21:00`, or null for a dream with no slot. */
const span = (dream: Session) =>
  dream.time_slot_start === null || dream.time_slot_end === null
    ? null
    : `${toLocalInput(dream.time_slot_start).slice(11)}–${toLocalInput(dream.time_slot_end).slice(11)}`

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
  const [dragged, setDragged] = useState<string | undefined>(undefined)

  // The burn comes first: since #156 the lanes belong to one, so there is no grid to
  // ask for until we know which.
  const { loaded, reload } = useLoad<Timetable>(
    async (signal) => {
      const active = await api.getActiveEvent(signal)
      if (active.event === null) return { event: null, places: [], sessions: [] }

      const [places, dreams] = await Promise.all([
        api.getPlaces(active.event.id, signal),
        api.getSessions(signal),
      ])

      return { event: active.event, places: places.places, sessions: dreams.sessions }
    },
    { enabled: member, fallback: 'Could not load the schedule.' },
  )

  const { busy, error, run } = useAction(reload)

  const move = (id: string, changes: Parameters<ScheduleApi['updateSession']>[1]) => {
    run(() => api.updateSession(id, changes), 'Could not move that dream.')
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

  const { event, places, sessions } = loaded.data

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
          No places yet, so there are no lanes to put anything in. They are added under{' '}
          <a href="/places">Places</a>.
        </p>
      </Framed>
    )
  }

  const rows = hoursOf(event.start_date, event.end_date, event.start_time, event.end_time)

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
    title={span(dream) ?? undefined}
    onDragStart={(dragEvent) => {
      // Firefox refuses to start a drag whose data store was never written to,
      // so this is what makes the gesture work at all there. The id is carried
      // in state rather than read back out of the transfer; this only has to
      // exist.
      dragEvent.dataTransfer?.setData('text/plain', dream.id)
      onDragStart(dream.id)
    }}
  >
    {dream.title}
    {span(dream) !== null && <span class="dream-span">{span(dream)}</span>}
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
}) => {
  const lanes = new Map(
    places.map((place) => [
      place.id,
      laneCells(
        rows,
        dreams.filter((dream) => dream.place_id === place.id),
      ),
    ]),
  )

  return (
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
          {rows.map((row, index) => (
            <tr key={row} class={label(row) === '00:00' ? 'schedule-daybreak' : undefined}>
              <th scope="row">{label(row) === '00:00' ? `${dayOf(row)} 00:00` : label(row)}</th>
              {places.map((place) => {
                const cell = lanes.get(place.id)?.[index]
                // A covered row renders no cell at all: the `rowSpan` above is
                // already occupying it, and adding one here shifts the column.
                if (cell === undefined || cell.kind === 'covered') return null

                return (
                  <td
                    key={place.id}
                    rowSpan={cell.kind === 'anchor' ? cell.span : undefined}
                    class={`schedule-cell place-${place.color}`}
                    onDragOver={(dragEvent) => dragEvent.preventDefault()}
                    onDrop={(dropEvent) => {
                      dropEvent.preventDefault()
                      onDrop(row, place.id)
                    }}
                  >
                    {cell.kind === 'anchor' &&
                      cell.dreams.map((dream) => {
                        const full = dreams.find((entry) => entry.id === dream.id)

                        return full === undefined ? null : (
                          <Chip key={full.id} dream={full} busy={busy} onDragStart={onDragStart} />
                        )
                      })}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
