import type { Place, Session } from '@sage-burner/shared'

import { DREAM_PARAM, dreamsPage, MAX_TITLE } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { Opened } from '../components/OpenedDream.tsx'

import { useSelectedBurn } from '../burn.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { Icon } from '../components/Icon.tsx'
import { dreamActions, OpenedDream, threadOf, useDreamThread } from '../components/OpenedDream.tsx'
import { Refreshing } from '../components/Refreshing.tsx'
import { shortDayOf } from '../datetime.ts'
import { joinLink } from '../joining.ts'
import { useAction, useLoad } from '../load.ts'
import {
  dreamIdOf,
  heldOr,
  openedFrom,
  panelIsShowing,
  useOpenedInUrl,
  usePanelAsPage,
} from '../panel-url.ts'
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
  | 'supportComment'
  | 'withdrawSupportForComment'
  | 'uploadImage'
>

const placeLabel = (places: readonly Place[], id: string | null) => {
  const found = places.find((row) => row.id === id)

  return found === undefined ? undefined : `${found.emoji} ${found.name}`
}

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

const EMPTY = { sessions: [], places: [], attendees: [] }

export const Dreams = ({ api }: { api: DreamsApi }) => {
  const viewer = useViewer()
  const approved = isApproved(viewer)
  const [title, setTitle] = useState('')
  const [opened, setOpenedPanel] = useState<Opened | undefined>(undefined)

  const burn = useSelectedBurn()
  const { loaded, refreshing, reload } = useLoad(
    async (signal) => {
      if (burn === undefined) return EMPTY

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

  const setOpened = (next: Opened | undefined) => {
    setError(undefined)
    setOpenedPanel(next)
    showInUrl(dreamIdOf(next))
  }

  const { support, help, facilitate, save, remove } = dreamActions({
    api,
    run,
    setOpened,
    viewerId: viewer.account?.id,
  })

  const showInUrl = useOpenedInUrl(
    DREAM_PARAM,
    (id) =>
      burn === undefined ? undefined : dreamsPage(burn.event.id, id === undefined ? {} : { dream: id }),
    (asked) => setOpenedPanel((held) => openedFrom(held, asked)),
  )

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

  const held = heldOr(loaded, EMPTY)
  const { sessions: dreams, places, attendees } = held

  const talk = useDreamThread({ api, threadId: threadOf(dreams, opened), run })

  const asPage = usePanelAsPage(panelIsShowing(dreams, opened))

  return (
    <GuardedPage title="Dreams" require="approved">
      <h1>
        Dreams <Refreshing on={refreshing} />
      </h1>

      {!asPage && (
        <>
          <p class="form-note">
            Workshops, ceremonies, happenings — whatever you want to offer. Say what it is now and work out
            when later; most dreams have no time until quite close to the burn.
          </p>

          {error !== undefined && opened === undefined && (
            <ErrorText message={error} link={joinLink(error)} />
          )}

          {loaded.status === 'loading' && <p class="form-note">Loading…</p>}

          {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

          {loaded.status === 'ready' && dreams.length === 0 && (
            <p class="form-note">Nobody has offered a dream yet. Yours can be the first.</p>
          )}

          <ol class="dream-list">
            {dreams.map((dream) => (
              <li key={dream.id} class="dream-row">
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
                        <Icon name="repeats" />
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
        </>
      )}

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
