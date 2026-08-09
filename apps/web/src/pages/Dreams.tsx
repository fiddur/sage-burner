import type { Place, Session } from '@sage-burner/shared'

import { DREAM_PARAM, MAX_TITLE } from '@sage-burner/shared'
import { useLocation } from 'preact-iso'
import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { Opened } from '../components/OpenedDream.tsx'

import { useSelectedBurn } from '../burn.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { dreamActions, OpenedDream, threadOf, useDreamThread } from '../components/OpenedDream.tsx'
import { Refreshing } from '../components/Refreshing.tsx'
import { shortDayOf } from '../datetime.ts'
import { useAction, useLoad } from '../load.ts'
import { isAdmin, isApproved, useViewer } from '../viewer.tsx'

export type DreamsApi = Pick<
  ApiClient,
  | 'getSessions'
  | 'offerSession'
  | 'updateSession'
  | 'withdrawSession'
  | 'getPlaces'
  | 'getEventAttendees'
  | 'helpWithSession'
  | 'stopHelpingWithSession'
  | 'supportSession'
  | 'withdrawSupportForSession'
  | 'getThread'
  | 'postComment'
  | 'updateComment'
  | 'deleteComment'
  | 'uploadImage'
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
 *
 * **A row opens the panel the grid opens** (#342). It used to swap itself for an edit
 * form, so a dream had two ways to be read and two to be edited, and only the grid's
 * had the description, the helpers and the supporters on it — the list showed a title
 * and a time, and nothing said what a dream actually _was_. The row's ✏️ and 🗑️ went
 * with the second form: on a phone they wrapped onto a third line, under a title they
 * no longer sat beside.
 */
export const Dreams = ({ api }: { api: DreamsApi }) => {
  const viewer = useViewer()
  const approved = isApproved(viewer)
  const [title, setTitle] = useState('')
  const [opened, setOpenedPanel] = useState<Opened | undefined>(undefined)

  // The burn comes first: since #156 the lanes belong to one. With no burn open
  // there is nothing to offer a dream to either, and `getSessions` says so anyway.
  const burn = useSelectedBurn()
  const { loaded, refreshing, reload } = useLoad(
    async (signal) => {
      if (burn === undefined) return { sessions: [], places: [], attendees: [] }

      const [dreams, places, attendees] = await Promise.all([
        api.getSessions(burn.event.id, signal),
        api.getPlaces(burn.event.id, signal),
        api.getEventAttendees(burn.event.id, signal),
      ])

      return { sessions: dreams.sessions, places: places.places, attendees: attendees.attendees }
    },
    {
      enabled: approved,
      key: burn?.event.id ?? '',
      fallback: 'Could not load the dreams.',
      live: true,
      remember: 'dreams',
    },
  )

  const { busy, error, setError, run } = useAction(reload)

  // Every way the panel opens or closes, so none of them can forget the error (#206):
  // `useAction` keeps its message until the next write, and the panel shows whatever
  // it is holding as its own `role="alert"`.
  const setOpened = (next: Opened | undefined) => {
    setError(undefined)
    setOpenedPanel(next)
  }

  const { support, help, facilitate, save, remove } = dreamActions({ api, run, setOpened })

  // A link that names a dream opens it — the feed's cards and the notifications about
  // them both do (#375). Keyed on the parameter rather than folded into the panel's own
  // state, so closing it stays closed: following a link is a choice, not a lock. A dream
  // the burn does not have simply opens nothing, which is what a withdrawn one does.
  const asked: string | undefined = useLocation().query?.[DREAM_PARAM]

  useEffect(() => {
    if (asked !== undefined) setOpenedPanel({ kind: 'dream', id: asked, editing: false })
  }, [asked])

  const offerByTitle = () => {
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

  const talk = useDreamThread({ api, threadId: threadOf(dreams, opened), run })

  return (
    <GuardedPage title="Dreams" require="approved">
      <h1>
        Dreams <Refreshing on={refreshing} />
      </h1>

      <p class="form-note">
        Workshops, ceremonies, happenings — whatever you want to offer. Say what it is now and work out when
        later; most dreams have no time until quite close to the burn.
      </p>

      {/* Only when no panel is open: the overlay covers this, and the panel shows the
          same message itself — two would also be announced twice. The grid guards its
          own the same way. */}
      {error !== undefined && opened === undefined && <ErrorText message={error} />}

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}

      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      {loaded.status === 'ready' && dreams.length === 0 && (
        <p class="form-note">Nobody has offered a dream yet. Yours can be the first.</p>
      )}

      <ol class="dream-list">
        {dreams.map((dream) => (
          <li key={dream.id} class="dream-row">
            {/* Named for what it does rather than by everything inside it, which is
                also what the grid's chip is called — the two pages open one panel and
                a screen reader should hear one instruction. */}
            <button
              type="button"
              class="dream-row-open"
              aria-label={`Open ${dream.title}`}
              disabled={busy}
              onClick={() => setOpened({ kind: 'dream', id: dream.id, editing: false })}
            >
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
            </button>
          </li>
        ))}
      </ol>

      <form
        class="form"
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault()
          offerByTitle()
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

      <OpenedDream
        opened={opened}
        dreams={dreams}
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
        onRemove={remove}
      />
    </GuardedPage>
  )
}
