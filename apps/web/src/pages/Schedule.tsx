import type { EventAttendeesResponse, MyBurn, Place, Session, SessionUpdate } from '@sage-burner/shared'
import type { ComponentChildren } from 'preact'

import { useRef, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { useSelectedBurn } from '../burn.tsx'
import { DreamDetails } from '../components/DreamDetails.tsx'
import { DreamFields } from '../components/DreamFields.tsx'
import { DreamPanel } from '../components/DreamPanel.tsx'
import { NoBurn } from '../components/NoBurn.tsx'
import { fromLocalInput, toLocalInput } from '../datetime.ts'
import { initials } from '../initials.ts'
import { useAction, useLoad } from '../load.ts'
import { endFor, hourOf, hoursOf, laneCells, resizedEnd, rowsDragged } from '../schedule.ts'
import { isMember, useViewer } from '../viewer.tsx'

export type ScheduleApi = Pick<
  ApiClient,
  | 'getSessions'
  | 'getPlaces'
  | 'updateSession'
  | 'offerSession'
  | 'getEventAttendees'
  | 'helpWithSession'
  | 'stopHelpingWithSession'
  | 'supportSession'
  | 'withdrawSupportForSession'
  | 'withdrawSession'
>

type Timetable = {
  event: MyBurn['event'] | null
  places: readonly Place[]
  sessions: readonly Session[]
  attendees: readonly EventAttendeesResponse['attendees'][number][]
}

/**
 * What the dialog is showing: an existing dream, or a new one being offered.
 *
 * The existing case holds an id rather than the dream, so a reload after a heart or
 * a helper leaves the panel showing what the server now says.
 */
type Opened =
  | { kind: 'dream'; id: string }
  | { kind: 'new'; place_id: string | null; time_slot_start: string | null; time_slot_end: string | null }

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
  const [opened, setOpened] = useState<Opened | undefined>(undefined)

  // The burn comes first: since #156 the lanes belong to one, so there is no grid to
  // ask for until we know which.
  const burn = useSelectedBurn()
  const { loaded, reload } = useLoad<Timetable>(
    async (signal) => {
      if (burn === undefined) return { event: null, places: [], sessions: [], attendees: [] }

      const [places, dreams, attendees] = await Promise.all([
        api.getPlaces(burn.event.id, signal),
        api.getSessions(burn.event.id, signal),
        api.getEventAttendees(burn.event.id, signal),
      ])

      return {
        event: burn.event,
        places: places.places,
        sessions: dreams.sessions,
        attendees: attendees.attendees,
      }
    },
    { enabled: member, key: burn?.event.id ?? '', fallback: 'Could not load the schedule.' },
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

  const { event, places, sessions, attendees } = loaded.data
  // By id, because a chip has one and needs a name for the circle.
  const names = new Map(attendees.map((person) => [person.account_id, person.name]))

  if (event === null) {
    return (
      <Framed>
        <NoBurn absent="there is no timetable to draw" />
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
    const placement = {
      place_id: placeId,
      time_slot_start: fromLocalInput(row),
      time_slot_end: endFor(row, dream),
    }

    if (dream.repeatable) {
      // A stamp rather than a thing that moves. The copy is an ordinary dream, or
      // moving it afterwards would stamp again.
      run(
        () =>
          api.offerSession(event.id, {
            title: dream.title,
            description: dream.description,
            facilitator_account_id: dream.facilitator_account_id,
            repeatable: false,
            ...placement,
          }),
        'Could not place that dream.',
      )
    } else {
      move(dream.id, placement)
    }

    setDragged(undefined)
  }

  const support = (id: string, supporting: boolean) => {
    run(
      () => (supporting ? api.supportSession(id) : api.withdrawSupportForSession(id)),
      'Could not save that.',
    )
  }

  const resize = (dream: Session, byRows: number) => {
    const end = resizedEnd(dream, byRows)
    if (end === null) return

    move(dream.id, { time_slot_end: end })
  }

  const help = (id: string, helping: boolean) => {
    run(() => (helping ? api.helpWithSession(id) : api.stopHelpingWithSession(id)), 'Could not save that.')
  }

  // The form disables its own button until there is a title, so the fallback is
  // unreachable — and if that ever stopped being true, an empty title is a 400 the
  // page reports, which beats a click that silently does nothing.
  const offer = ({ title = '', ...fields }: SessionUpdate) => {
    run(() => api.offerSession(event.id, { ...fields, title }), 'Could not offer that.')
    setOpened(undefined)
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
          names={names}
          busy={busy}
          onDragStart={setDragged}
          onOpen={(id) => setOpened({ kind: 'dream', id })}
          onOffer={() =>
            setOpened({ kind: 'new', place_id: null, time_slot_start: null, time_slot_end: null })
          }
          onSupport={support}
          onResize={resize}
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
          names={names}
          busy={busy}
          onDragStart={setDragged}
          onOpen={(id) => setOpened({ kind: 'dream', id })}
          onOfferAt={(row, placeId) =>
            setOpened({
              kind: 'new',
              place_id: placeId,
              time_slot_start: fromLocalInput(row),
              time_slot_end: endFor(row, { time_slot_start: null, time_slot_end: null }),
            })
          }
          onSupport={support}
          onResize={resize}
          onDrop={dropInto}
        />
      </div>

      <Opened
        opened={opened}
        dreams={sessions}
        places={places}
        attendees={attendees}
        names={names}
        viewerId={viewer.account?.id}
        busy={busy}
        onClose={() => setOpened(undefined)}
        onHelp={help}
        onSupport={support}
        onSave={move}
        onOffer={offer}
        onRemove={(id) => {
          run(() => api.withdrawSession(id), 'Could not withdraw that.')
          setOpened(undefined)
        }}
      />
    </Framed>
  )
}

/**
 * Whichever panel is open over the grid, or nothing.
 *
 * Its own component so the page keeps one branch where it had four — the same
 * reason `NoBurn` is one.
 */
const Opened = ({
  opened,
  dreams,
  places,
  attendees,
  names,
  viewerId,
  busy,
  onClose,
  onHelp,
  onSupport,
  onSave,
  onOffer,
  onRemove,
}: {
  opened: Opened | undefined
  dreams: readonly Session[]
  places: readonly Place[]
  attendees: readonly EventAttendeesResponse['attendees'][number][]
  names: ReadonlyMap<string, string | null>
  viewerId: string | undefined
  busy: boolean
  onClose: () => void
  onHelp: (id: string, helping: boolean) => void
  onSupport: (id: string, supporting: boolean) => void
  onSave: (id: string, changes: SessionUpdate) => void
  onOffer: (fields: SessionUpdate) => void
  onRemove: (id: string) => void
}) => {
  if (opened === undefined) return null

  if (opened.kind === 'new') {
    return (
      <DreamPanel label="Offer a dream" onClose={onClose}>
        <h2>Offer a dream</h2>
        <DreamFields
          dream={{
            title: '',
            description: '',
            facilitator_account_id: null,
            repeatable: false,
            place_id: opened.place_id,
            time_slot_start: opened.time_slot_start,
            time_slot_end: opened.time_slot_end,
          }}
          subject="the new dream"
          places={places}
          attendees={attendees}
          busy={busy}
          creating
          onCancel={onClose}
          onSave={onOffer}
        />
      </DreamPanel>
    )
  }

  // Looked up rather than held, so a reload after a heart or a helper leaves the
  // panel showing what the server now says.
  const dream = dreams.find((candidate) => candidate.id === opened.id)
  if (dream === undefined) return null

  return (
    <DreamDetails
      dream={dream}
      places={places}
      attendees={attendees}
      facilitatorName={
        dream.facilitator_account_id === null ? undefined : names.get(dream.facilitator_account_id)
      }
      viewerId={viewerId}
      busy={busy}
      onClose={onClose}
      onHelp={(helping) => onHelp(dream.id, helping)}
      onSupport={(supporting) => onSupport(dream.id, supporting)}
      onSave={(changes) => onSave(dream.id, changes)}
      onRemove={() => onRemove(dream.id)}
    />
  )
}

const Framed = ({ children }: { children: ComponentChildren }) => (
  <section class="page">
    <h1>Schedule</h1>
    {children}
  </section>
)

const Chip = ({
  dream,
  names,
  busy,
  resizable,
  onDragStart,
  onOpen,
  onSupport,
  onResize,
}: {
  dream: Session
  names: ReadonlyMap<string, string | null>
  busy: boolean
  /** Only in the grid: there are no rows to pull against in the pool. */
  resizable: boolean
  onDragStart: (id: string) => void
  onOpen: (id: string) => void
  onSupport: (id: string, supporting: boolean) => void
  onResize: (dream: Session, byRows: number) => void
}) => {
  // Google Calendar's rule: the click a drag leaves behind is not a click. Cleared
  // on the next press rather than on `dragend`, which fires *before* that click.
  const dragging = useRef(false)
  const grabbed = useRef<{ y: number; rowHeight: number } | null>(null)

  return (
    <span
      class="dream-chip"
      draggable={!busy}
      aria-label={`Move ${dream.title}`}
      title={span(dream) ?? undefined}
      onMouseDown={() => {
        dragging.current = false
      }}
      onDragStart={(dragEvent) => {
        // `draggable` is on the chip, so a grab anywhere inside it — the resize
        // handle included — would otherwise drag the whole dream to another lane.
        if (grabbed.current !== null) {
          dragEvent.preventDefault()
          return
        }

        // Firefox refuses to start a drag whose data store was never written to,
        // so this is what makes the gesture work at all there. The id is carried
        // in state rather than read back out of the transfer; this only has to
        // exist.
        dragging.current = true
        dragEvent.dataTransfer?.setData('text/plain', dream.id)
        onDragStart(dream.id)
      }}
      onClick={() => {
        if (dragging.current) return
        onOpen(dream.id)
      }}
    >
      <button type="button" class="dream-open" aria-label={`Open ${dream.title}`}>
        {dream.title}
        {dream.repeatable && (
          <span class="dream-repeats">
            <span aria-hidden="true">↻</span>
            <span class="visually-hidden">Can be planned more than once</span>
          </span>
        )}
      </button>
      <Facilitator dream={dream} names={names} />
      <Support dream={dream} busy={busy} onSupport={onSupport} />
      {span(dream) !== null && <span class="dream-span">{span(dream)}</span>}

      {resizable && (
        <button
          type="button"
          class="dream-resize"
          disabled={busy}
          aria-label={`Change how long ${dream.title} is`}
          onPointerDown={(pointerEvent) => {
            // Measured off the cell rather than from a number the CSS and this
            // would both have to hold: it spans `rowspan` rows, so its own height
            // says what a row is worth on this screen.
            const cell = pointerEvent.currentTarget.closest('td')
            const spanned = Math.max(Number(cell?.getAttribute('rowspan') ?? '1'), 1)
            const height = cell?.getBoundingClientRect().height ?? 0

            grabbed.current = { y: pointerEvent.clientY, rowHeight: height / spanned }
            pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId)
          }}
          onPointerUp={(pointerEvent) => {
            const grab = grabbed.current
            grabbed.current = null
            if (grab === null) return

            onResize(dream, rowsDragged(pointerEvent.clientY - grab.y, grab.rowHeight))
          }}
          // Or a lost capture leaves the ref set, and `onDragStart` goes on
          // cancelling every drag of this chip until the handle is grabbed again.
          onPointerCancel={() => {
            grabbed.current = null
          }}
          onClick={(clickEvent) => clickEvent.stopPropagation()}
          onKeyDown={(keyEvent) => {
            // The handle is the keyboard route too, like the ⠿ on Places: a
            // resize nobody can do without a mouse is one half the people here
            // cannot do.
            const by = keyEvent.key === 'ArrowDown' ? 1 : keyEvent.key === 'ArrowUp' ? -1 : undefined
            if (by === undefined) return

            keyEvent.preventDefault()
            onResize(dream, by)
          }}
        >
          <span aria-hidden="true">⇕</span>
        </button>
      )}
    </span>
  )
}

/**
 * The ♡ that fills in, with how many people have given one.
 *
 * The click is stopped here rather than bubbling on to the chip: giving a dream a
 * heart is not a request to read about it.
 */
const Support = ({
  dream,
  busy,
  onSupport,
}: {
  dream: Session
  busy: boolean
  onSupport: (id: string, supporting: boolean) => void
}) => (
  <button
    type="button"
    class="dream-heart"
    disabled={busy}
    aria-pressed={dream.supported_by_me}
    aria-label={`${dream.supported_by_me ? 'Take back your support for' : 'Show support for'} ${dream.title}`}
    onClick={(clickEvent) => {
      clickEvent.stopPropagation()
      onSupport(dream.id, !dream.supported_by_me)
    }}
  >
    <span aria-hidden="true">{dream.supported_by_me ? '❤️‍🔥' : '♡'}</span>
    {dream.support_count > 0 && <span class="dream-heart-count">{dream.support_count}</span>}
  </button>
)

/**
 * Who is running it, as the initials circle the corner uses.
 *
 * The name is on `title` rather than beside the letters: a chip is an hour tall at
 * best, and two of them in a lane get half that. Nothing when nobody has been handed
 * it — an empty circle would read as somebody whose name is missing.
 */
const Facilitator = ({ dream, names }: { dream: Session; names: ReadonlyMap<string, string | null> }) => {
  const who = dream.facilitator_account_id
  if (who === null) return null

  const name = names.get(who) ?? null

  return (
    <span class="avatar dream-facilitator" title={name ?? 'Name not filled in yet'}>
      <span aria-hidden="true">{initials(name)}</span>
      <span class="visually-hidden">Facilitated by {name ?? 'somebody who has no name filled in'}</span>
    </span>
  )
}

const Pool = ({
  dreams,
  names,
  busy,
  onDragStart,
  onOpen,
  onOffer,
  onSupport,
  onResize,
  onDrop,
}: {
  dreams: readonly Session[]
  names: ReadonlyMap<string, string | null>
  busy: boolean
  onDragStart: (id: string) => void
  onOpen: (id: string) => void
  onOffer: () => void
  onSupport: (id: string, supporting: boolean) => void
  onResize: (dream: Session, byRows: number) => void
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
    <h2>
      Not placed yet
      <button type="button" class="link-button" disabled={busy} aria-label="Offer a dream" onClick={onOffer}>
        ＋
      </button>
    </h2>

    {dreams.length === 0 && <p class="form-note">Everything has somewhere to be.</p>}

    {dreams.map((dream) => (
      <p key={dream.id}>
        <Chip
          dream={dream}
          names={names}
          busy={busy}
          resizable={false}
          onDragStart={onDragStart}
          onOpen={onOpen}
          onSupport={onSupport}
          onResize={onResize}
        />
      </p>
    ))}

    <p class="form-note">
      Drag one into the grid to place it, or click an empty hour to offer something there. A ↻ dream stays
      here when you place it, so the same one can go into several mornings. The whole list is on{' '}
      <a href="/dreams">Dreams</a>.
    </p>
  </aside>
)

const Timetable = ({
  rows,
  places,
  dreams,
  names,
  busy,
  onDragStart,
  onOpen,
  onOfferAt,
  onSupport,
  onResize,
  onDrop,
}: {
  rows: readonly string[]
  places: readonly Place[]
  dreams: readonly Session[]
  names: ReadonlyMap<string, string | null>
  busy: boolean
  onDragStart: (id: string) => void
  onOpen: (id: string) => void
  onOfferAt: (row: string, placeId: string) => void
  onSupport: (id: string, supporting: boolean) => void
  onResize: (dream: Session, byRows: number) => void
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
                    onClick={() => {
                      // Only an empty hour. A click that reached an anchor cell went
                      // past the chip filling it, and offering a second dream on top
                      // of one somebody just clicked is not what they meant.
                      if (cell.kind === 'empty') onOfferAt(row, place.id)
                    }}
                  >
                    {cell.kind === 'anchor' && (
                      // Out of flow against the cell, so the block is as tall as the
                      // hours it spans rather than as tall as its own text. See
                      // `.dream-stack`.
                      <div class="dream-stack">
                        {cell.dreams.map((dream) => {
                          const full = dreams.find((entry) => entry.id === dream.id)

                          return full === undefined ? null : (
                            <Chip
                              key={full.id}
                              dream={full}
                              names={names}
                              busy={busy}
                              resizable
                              onDragStart={onDragStart}
                              onOpen={onOpen}
                              onSupport={onSupport}
                              onResize={onResize}
                            />
                          )
                        })}
                      </div>
                    )}
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
