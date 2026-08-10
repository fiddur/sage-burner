import type { EventAttendeesResponse, Meal, MyBurn, Place, Session, SessionUpdate } from '@sage-burner/shared'
import type { ComponentChildren } from 'preact'

import { useRef, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { CalendarFeedApi } from '../components/CalendarFeed.tsx'
import type { Opened } from '../components/OpenedDream.tsx'
import type { Pinch } from '../pinch.ts'
import type { LaneCell, MealBlock } from '../schedule.ts'

import { useSelectedBurn } from '../burn.tsx'
import { Avatar } from '../components/Avatar.tsx'
import { CalendarFeed } from '../components/CalendarFeed.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { MealDialog } from '../components/MealDialog.tsx'
import { NoBurn } from '../components/NoBurn.tsx'
import { NotForYou } from '../components/NotForYou.tsx'
import { dreamActions, OpenedDream, threadOf, useDreamThread } from '../components/OpenedDream.tsx'
import { Refreshing } from '../components/Refreshing.tsx'
import { dayName, fromLocalInput, toLocalInput } from '../datetime.ts'
import { useAction, useLoad } from '../load.ts'
import { pinchedZoom, touchGap } from '../pinch.ts'
import {
  endFor,
  hourOf,
  hoursOf,
  laneCells,
  mealBlocks,
  mealMovedTo,
  resizedEnd,
  rowsDragged,
} from '../schedule.ts'
import { isAdmin, isApproved, useViewer } from '../viewer.tsx'

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
  | 'getMeals'
  | 'updateMeal'
  | 'setMealLead'
  | 'joinMealCrew'
  | 'leaveMealCrew'
  | 'setMealIdea'
  | 'getThread'
  | 'postComment'
  | 'updateComment'
  | 'deleteComment'
  | 'uploadImage'
> &
  CalendarFeedApi

type Person = EventAttendeesResponse['attendees'][number]

type Timetable = {
  event: MyBurn['event'] | null
  places: readonly Place[]
  sessions: readonly Session[]
  attendees: readonly EventAttendeesResponse['attendees'][number][]
  meals: readonly Meal[]
}

const label = (row: string) => row.slice(11)

const span = (dream: Session) =>
  dream.time_slot_start === null || dream.time_slot_end === null
    ? null
    : `${toLocalInput(dream.time_slot_start).slice(11)}–${toLocalInput(dream.time_slot_end).slice(11)}`

const dayOf = (row: string) => row.slice(0, 10)

export const Schedule = ({ api }: { api: ScheduleApi }) => {
  const viewer = useViewer()
  const approved = isApproved(viewer)
  const [dragged, setDragged] = useState<string | undefined>(undefined)
  const [draggedMeal, setDraggedMeal] = useState<MealBlock | undefined>(undefined)
  const [opened, setOpenedPanel] = useState<Opened | undefined>(undefined)
  const [openedMeal, setOpenedMealPanel] = useState<string | undefined>(undefined)

  const burn = useSelectedBurn()
  const { loaded, refreshing, reload } = useLoad<Timetable>(
    async (signal) => {
      if (burn === undefined) return { event: null, places: [], sessions: [], attendees: [], meals: [] }

      const [places, dreams, attendees, plan] = await Promise.all([
        api.getPlaces(burn.event.id, signal),
        api.getSessions(burn.event.id, signal),
        api.getEventAttendees(burn.event.id, signal),
        api.getMeals(burn.event.id, signal),
      ])

      return {
        event: burn.event,
        places: places.places,
        sessions: dreams.sessions,
        attendees: attendees.attendees,
        meals: plan.meals,
      }
    },
    {
      enabled: approved,
      key: burn?.event.id ?? '',
      fallback: 'Could not load the schedule.',
      live: true,
      remember: 'schedule',
    },
  )

  const { busy, error, run, setError } = useAction(reload)

  const setOpened = (next: Opened | undefined) => {
    setError(undefined)
    setOpenedPanel(next)
  }

  const setOpenedMeal = (next: string | undefined) => {
    setError(undefined)
    setOpenedMealPanel(next)
  }

  const move = (id: string, changes: Parameters<ScheduleApi['updateSession']>[1]) => {
    run(() => api.updateSession(id, changes), 'Could not move that dream.')
  }

  if (viewer.status === 'loading') return <Framed api={api}>{<p class="form-note">One moment…</p>}</Framed>

  if (!approved) {
    return (
      <Framed api={api}>
        <NotForYou signedOut={viewer.status === 'signed-out'} who="members" />
      </Framed>
    )
  }

  if (loaded.status === 'loading') return <Framed api={api}>{<p class="form-note">Loading…</p>}</Framed>

  if (loaded.status === 'failed') {
    return (
      <Framed api={api}>
        <ErrorText message={loaded.message} />
      </Framed>
    )
  }

  const { event, places, sessions, attendees, meals } = loaded.data
  const people = new Map(attendees.map((person) => [person.account_id, person]))

  if (event === null) {
    return (
      <Framed api={api}>
        <NoBurn absent="there is no timetable to draw" />
      </Framed>
    )
  }

  if (places.length === 0 && meals.length === 0) {
    return (
      <Framed api={api}>
        <p class="notice">
          No places yet, so there are no lanes to put anything in. They are added under{' '}
          <a href="/places">Places</a>.
        </p>
      </Framed>
    )
  }

  const rows = hoursOf(event.start_date, event.end_date, event.start_time, event.end_time)

  const drawn = new Set(
    sessions
      .filter((dream) => dream.place_id !== null && rows.includes(hourOf(dream.time_slot_start) ?? ''))
      .map((dream) => dream.id),
  )
  const unscheduled = sessions.filter((dream) => !drawn.has(dream.id))

  const dropInto = (row: string, placeId: string) => {
    const dream = sessions.find((candidate) => candidate.id === dragged)
    if (dream === undefined) return

    const placement = {
      place_id: placeId,
      time_slot_start: fromLocalInput(row),
      time_slot_end: endFor(row, dream),
    }

    if (dream.repeatable) {
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

  const resize = (dream: Session, byRows: number) => {
    const end = resizedEnd(dream, byRows)
    if (end === null) return

    move(dream.id, { time_slot_end: end })
  }

  const dragDream = (id: string) => {
    setDragged(id)
    setDraggedMeal(undefined)
  }

  const dragMeal = (block: MealBlock) => {
    setDraggedMeal(block)
    setDragged(undefined)
  }

  const endDrag = () => {
    setDragged(undefined)
    setDraggedMeal(undefined)
  }

  const blocks = meals.flatMap((meal) => mealBlocks(meal))
  const shownMeal = meals.find((meal) => meal.id === openedMeal)

  const { support, help, facilitate, save, remove } = dreamActions({ api, run, setOpened })
  const talk = useDreamThread({ api, threadId: threadOf(sessions, opened), run })

  const offer = ({ title = '', ...fields }: SessionUpdate) => {
    run(async () => {
      await api.offerSession(event.id, { ...fields, title })
      setOpened(undefined)
    }, 'Could not offer that.')
  }

  return (
    <Framed api={api} eventId={event.id} refreshing={refreshing}>
      {error !== undefined && opened === undefined && shownMeal === undefined && (
        <ErrorText message={error} />
      )}

      <div class="schedule">
        <Pool
          dreams={unscheduled}
          people={people}
          busy={busy}
          onDragStart={dragDream}
          onDragEnd={endDrag}
          onOpen={(id) => setOpened({ kind: 'dream', id, editing: false })}
          onOffer={() =>
            setOpened({ kind: 'new', place_id: null, time_slot_start: null, time_slot_end: null })
          }
          onSupport={support}
          onResize={resize}
          onDrop={() => {
            if (dragged === undefined) return
            move(dragged, { place_id: null, time_slot_start: null, time_slot_end: null })
            setDragged(undefined)
          }}
        />

        <Timetable
          rows={rows}
          places={places}
          blocks={blocks}
          onOpenMeal={setOpenedMeal}
          onDragMeal={dragMeal}
          onDropInKitchen={(row) => {
            const to = draggedMeal && mealMovedTo(draggedMeal.part, row)
            setDraggedMeal(undefined)
            if (to) run(() => api.updateMeal(draggedMeal.meal_id, to), 'Could not move that meal.')
          }}
          dreams={sessions}
          people={people}
          busy={busy}
          onDragStart={dragDream}
          onDragEnd={endDrag}
          onOpen={(id) => setOpened({ kind: 'dream', id, editing: false })}
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

      <OpenedMeal
        meal={shownMeal}
        api={api}
        attendees={attendees}
        viewerId={viewer.account?.id}
        busy={busy}
        error={error}
        run={run}
        onClose={() => setOpenedMeal(undefined)}
      />

      <OpenedDream
        opened={opened}
        dreams={sessions}
        places={places}
        attendees={attendees}
        talk={talk}
        viewerId={viewer.account?.id}
        admin={isAdmin(viewer)}
        upload={api.uploadImage}
        busy={busy}
        error={error}
        onEdit={(id) => setOpened({ kind: 'dream', id, editing: true })}
        onCancelEdit={(id) => setOpened({ kind: 'dream', id, editing: false })}
        onClose={() => setOpened(undefined)}
        onFacilitate={facilitate}
        onHelp={help}
        onSupport={support}
        onSave={save}
        onOffer={offer}
        onRemove={remove}
      />
    </Framed>
  )
}

const Framed = ({
  api,
  eventId,
  refreshing = false,
  children,
}: {
  api: CalendarFeedApi
  eventId?: string
  refreshing?: boolean
  children: ComponentChildren
}) => (
  <section class="page">
    <h1>
      Schedule <Refreshing on={refreshing} />
    </h1>
    {eventId !== undefined && <CalendarFeed api={api} eventId={eventId} />}
    {children}
  </section>
)

const Chip = ({
  dream,
  people,
  busy,
  resizable,
  onDragStart,
  onDragEnd,
  onOpen,
  onSupport,
  onResize,
}: {
  dream: Session
  people: ReadonlyMap<string, Person>
  busy: boolean
  resizable: boolean
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onOpen: (id: string) => void
  onSupport: (id: string, supporting: boolean) => void
  onResize: (dream: Session, byRows: number) => void
}) => {
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
        if (grabbed.current !== null) {
          dragEvent.preventDefault()
          return
        }

        dragging.current = true
        dragEvent.dataTransfer?.setData('text/plain', dream.id)
        onDragStart(dream.id)
      }}
      onDragEnd={onDragEnd}
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
      <Facilitator dream={dream} people={people} />
      <Support dream={dream} busy={busy} onSupport={onSupport} />
      {span(dream) !== null && <span class="dream-span">{span(dream)}</span>}

      {resizable && (
        <button
          type="button"
          class="dream-resize"
          disabled={busy}
          aria-label={`Change how long ${dream.title} is`}
          onPointerDown={(pointerEvent) => {
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
          onPointerCancel={() => {
            grabbed.current = null
          }}
          onClick={(clickEvent) => clickEvent.stopPropagation()}
          onKeyDown={(keyEvent) => {
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

const Facilitator = ({ dream, people }: { dream: Session; people: ReadonlyMap<string, Person> }) => {
  const who = dream.facilitator_account_id
  if (who === null) return null

  const name = people.get(who)?.name ?? null

  return (
    <span class="dream-facilitator-wrap" title={name ?? 'Name not filled in yet'}>
      <Avatar accountId={who} name={name} avatar={people.get(who)?.avatar ?? null} size="dream-facilitator" />
      <span class="visually-hidden">Facilitated by {name ?? 'somebody who has no name filled in'}</span>
    </span>
  )
}

const Pool = ({
  dreams,
  people,
  busy,
  onDragStart,
  onDragEnd,
  onOpen,
  onOffer,
  onSupport,
  onResize,
  onDrop,
}: {
  dreams: readonly Session[]
  people: ReadonlyMap<string, Person>
  busy: boolean
  onDragStart: (id: string) => void
  onDragEnd: () => void
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
          people={people}
          busy={busy}
          resizable={false}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
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
  people,
  busy,
  blocks,
  onDragStart,
  onDragEnd,
  onOpen,
  onOfferAt,
  onOpenMeal,
  onDragMeal,
  onDropInKitchen,
  onSupport,
  onResize,
  onDrop,
}: {
  rows: readonly string[]
  places: readonly Place[]
  blocks: readonly MealBlock[]
  dreams: readonly Session[]
  people: ReadonlyMap<string, Person>
  busy: boolean
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onOpen: (id: string) => void
  onOfferAt: (row: string, placeId: string) => void
  onOpenMeal: (mealId: string) => void
  onDragMeal: (block: MealBlock) => void
  onDropInKitchen: (row: string) => void
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

  const kitchen = blocks.length === 0 ? undefined : laneCells(rows, blocks)
  const byId = new Map(blocks.map((block) => [block.id, block]))

  const columns = places.length + (kitchen === undefined ? 0 : 1)

  const [zoom, setZoom] = useState(1)
  const pinch = useRef<Pinch | undefined>(undefined)

  const twoFingerGap = (touches: TouchList): number | undefined =>
    touches.length === 2 && touches[0] !== undefined && touches[1] !== undefined
      ? touchGap(touches[0], touches[1])
      : undefined

  return (
    <div
      class="schedule-grid-wrap"
      style={{ '--zoom': zoom }}
      onTouchStart={(touchEvent) => {
        const gap = twoFingerGap(touchEvent.touches)
        if (gap !== undefined) pinch.current = { gap, zoom }
      }}
      onTouchMove={(touchEvent) => {
        const start = pinch.current
        const gap = twoFingerGap(touchEvent.touches)
        if (start !== undefined && gap !== undefined) setZoom(pinchedZoom(start, gap))
      }}
      onTouchEnd={() => {
        pinch.current = undefined
      }}
      onTouchCancel={() => {
        pinch.current = undefined
      }}
    >
      <table class="schedule-grid" style={{ '--lanes': columns }}>
        {/*
          Fixed layout, so the lanes share what is left equally rather than sizing
          themselves to whichever happens to hold the longest title. The time column's
          own width is in `.schedule-time-col`, which says what decides it.
        */}
        <colgroup>
          <col class="schedule-time-col" />
          {Array.from({ length: columns }, (_, at) => (
            <col key={at} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Time</th>
            {places.map((place) => (
              <th key={place.id} scope="col">
                <span aria-hidden="true">{place.emoji}</span> {place.name}
              </th>
            ))}
            {kitchen !== undefined && (
              <th scope="col">
                <span aria-hidden="true">🍳</span> Kitchen
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row} class={label(row) === '00:00' ? 'schedule-daybreak' : undefined}>
              {/* The first row too, not only midnights: a burn opens at 16:00, so it
                  starts a day without starting at one. */}
              <th scope="row">
                {index === 0 || dayOf(row) !== dayOf(rows[index - 1] ?? row) ? (
                  <span class="schedule-day">{dayName(dayOf(row), 'short')}</span>
                ) : null}
                {label(row)}
              </th>
              {places.map((place) => {
                const cell = lanes.get(place.id)?.[index]
                if (cell === undefined || cell.kind === 'covered') return null

                return (
                  <td
                    key={place.id}
                    rowSpan={cell.kind === 'anchor' ? cell.span : undefined}
                    class={`schedule-cell place-${place.color}${cell.kind === 'empty' ? ' is-free' : ''}`}
                    onDragOver={(dragEvent) => dragEvent.preventDefault()}
                    onDrop={(dropEvent) => {
                      dropEvent.preventDefault()
                      onDrop(row, place.id)
                    }}
                    onClick={() => {
                      if (cell.kind === 'empty') onOfferAt(row, place.id)
                    }}
                  >
                    {cell.kind === 'anchor' && (
                      <div class="dream-stack">
                        {cell.dreams.map((dream) => {
                          const full = dreams.find((entry) => entry.id === dream.id)

                          return full === undefined ? null : (
                            <Chip
                              key={full.id}
                              dream={full}
                              people={people}
                              busy={busy}
                              resizable
                              onDragStart={onDragStart}
                              onDragEnd={onDragEnd}
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

              {kitchen !== undefined && (
                <KitchenCell
                  cell={kitchen[index]}
                  blocks={byId}
                  busy={busy}
                  onOpenMeal={onOpenMeal}
                  onDragMeal={onDragMeal}
                  onDragEnd={onDragEnd}
                  onDrop={() => onDropInKitchen(row)}
                />
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const OpenedMeal = ({
  meal,
  api,
  attendees,
  viewerId,
  busy,
  error,
  run,
  onClose,
}: {
  meal: Meal | undefined
  api: Pick<ScheduleApi, 'joinMealCrew' | 'leaveMealCrew' | 'setMealIdea' | 'setMealLead' | 'updateMeal'>
  attendees: readonly EventAttendeesResponse['attendees'][number][]
  viewerId: string | undefined
  busy: boolean
  error: string | undefined
  run: (work: () => Promise<unknown>, fallback: string) => void
  onClose: () => void
}) => {
  if (meal === undefined) return null

  return (
    <MealDialog
      meal={meal}
      attendees={attendees}
      viewerId={viewerId}
      busy={busy}
      error={error}
      onClose={onClose}
      onLead={(accountId) =>
        run(() => api.setMealLead(meal.id, { account_id: accountId }), 'Could not save that.')
      }
      onStand={(role, joining, accountId) =>
        run(
          () =>
            joining
              ? api.joinMealCrew(meal.id, role, { account_id: accountId })
              : api.leaveMealCrew(meal.id, role, accountId),
          'Could not save that.',
        )
      }
      onIdea={(food_idea) => run(() => api.setMealIdea(meal.id, { food_idea }), 'Could not save that.')}
      onRename={(changes) => run(() => api.updateMeal(meal.id, changes), 'Could not save that.')}
    />
  )
}

const KitchenCell = ({
  cell,
  blocks,
  busy,
  onOpenMeal,
  onDragMeal,
  onDragEnd,
  onDrop,
}: {
  cell: LaneCell | undefined
  blocks: ReadonlyMap<string, MealBlock>
  busy: boolean
  onOpenMeal: (mealId: string) => void
  onDragMeal: (block: MealBlock) => void
  onDragEnd: () => void
  onDrop: () => void
}) => {
  if (cell === undefined || cell.kind === 'covered') return null

  return (
    <td
      class="schedule-cell schedule-kitchen"
      rowSpan={cell.kind === 'anchor' ? cell.span : undefined}
      onDragOver={(dragEvent) => dragEvent.preventDefault()}
      onDrop={(dropEvent) => {
        dropEvent.preventDefault()
        onDrop()
      }}
    >
      {cell.kind === 'anchor' && (
        <div class="dream-stack">
          {cell.dreams.map((placed) => {
            const block = blocks.get(placed.id)

            return block === undefined ? null : (
              <span
                key={block.id}
                class={`dream-chip meal-chip meal-${block.part}`}
                draggable={!busy}
                aria-label={`Move ${block.title}`}
                onDragStart={(dragEvent) => {
                  dragEvent.dataTransfer?.setData('text/plain', block.id)
                  onDragMeal(block)
                }}
                onDragEnd={onDragEnd}
              >
                <button
                  type="button"
                  class="dream-open"
                  aria-label={`Open ${block.title}`}
                  onClick={() => onOpenMeal(block.meal_id)}
                >
                  {block.title}
                </button>
              </span>
            )
          })}
        </div>
      )}
    </td>
  )
}
