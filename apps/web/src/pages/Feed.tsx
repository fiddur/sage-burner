import type { Activity, NotificationCategory, NotificationSettings, Thread } from '@sage-burner/shared'

import { BURN_PARAM, entryCategory, MAX_POST, MAX_TITLE, notificationCategoryInfo } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { UploadImage } from '../image-upload.ts'
import type { Mentionable } from '../mentioning.ts'

import { useSelectedBurn } from '../burn.tsx'
import { DreamThread } from '../components/DreamThread.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { MarkdownField } from '../components/MarkdownField.tsx'
import { Refreshing } from '../components/Refreshing.tsx'
import { localDay } from '../datetime.ts'
import { useAction, useLoad } from '../load.ts'
import { renderMarkdown } from '../markdown.ts'
import { isAdmin, isApproved, useViewer } from '../viewer.tsx'

export type FeedApi = Pick<
  ApiClient,
  | 'getFeed'
  | 'getMyNotificationSettings'
  | 'updateMyNotificationSettings'
  | 'getThread'
  | 'postComment'
  | 'updateComment'
  | 'deleteComment'
  | 'uploadImage'
  | 'addPost'
  | 'updatePost'
  | 'deletePost'
  | 'getEventAttendees'
>

interface Happening {
  activity: readonly Activity[]
  threads: readonly Thread[]
  settings: NotificationSettings
}

type Item = { at: string; id: string } & ({ line: Activity } | { card: Thread })

export const Feed = ({ api }: { api: FeedApi }) => {
  const viewer = useViewer()
  const approved = isApproved(viewer)
  const { loaded, refreshing, reload } = useLoad<Happening>(
    async (signal) => {
      const [feed, settings] = await Promise.all([api.getFeed(signal), api.getMyNotificationSettings(signal)])

      return { activity: feed.activity, threads: feed.threads, settings }
    },
    { enabled: approved, fallback: 'Could not load what has been going on.' },
  )

  const { busy, error, run } = useAction(reload)

  const [whole, setWhole] = useState<Record<string, Thread>>({})

  const settings = loaded.status === 'ready' ? loaded.data.settings : undefined

  const toggle = (category: NotificationCategory) => {
    if (settings === undefined) return

    const on = settings.on.includes(category)
    const wanted = {
      on: on ? settings.on.filter((one) => one !== category) : [...settings.on, category],
      email: [...settings.email],
    }

    run(() => api.updateMyNotificationSettings(wanted), 'Could not change that. Please try again.')
  }

  const held = (thread: Thread) => {
    setWhole((sofar) => ({ ...sofar, [thread.id]: thread }))
  }

  const forget = (threadId: string) => {
    setWhole(({ [threadId]: _gone, ...rest }) => rest)
  }

  const talk = {
    say: (id: string, body: string) => {
      run(async () => held((await api.postComment(id, { body })).thread), 'Could not say that.')
    },
    rewrite: (id: string, body: string) => {
      run(async () => held((await api.updateComment(id, { body })).thread), 'Could not save that.')
    },
    remove: (id: string) => {
      run(async () => held((await api.deleteComment(id)).thread), 'Could not take that back.')
    },
    showAll: (id: string) => {
      run(async () => held((await api.getThread(id)).thread), 'Could not load the rest of it.')
    },
    reword: (threadId: string, id: string, title: string, body: string, done: () => void) => {
      run(async () => {
        await api.updatePost(id, { title, body })
        forget(threadId)
        done()
      }, 'Could not save that. Please try again.')
    },
    takeBack: (threadId: string, id: string) => {
      run(async () => {
        await api.deletePost(id)
        forget(threadId)
      }, 'Could not take that back. Please try again.')
    },
  }

  const items = loaded.status === 'ready' ? feedItems(loaded.data) : []
  const selected = useSelectedBurn()
  const eventId = selected?.event.id

  // Whoever is coming to the burn in the bar, for the `@` menu. Two columns and nothing else,
  // which is what `getEventAttendees` exists to answer.
  const { loaded: coming } = useLoad(
    async (signal) => (eventId === undefined ? [] : (await api.getEventAttendees(eventId, signal)).attendees),
    { enabled: approved && eventId !== undefined, fallback: 'Could not load who is coming.' },
  )
  const people = coming.status === 'ready' ? coming.data : []

  return (
    <GuardedPage title="Feed" require="approved" width="column">
      <h1>
        Feed <Refreshing on={refreshing} />
      </h1>

      <p class="form-note">
        What people have been doing and saying, newest first. Say something on a dream and it comes back to
        the top. Tap what a line is about to be told about the next one at a burn you are coming to — the same
        switch as the one on <a href="/profile">your details</a>.
      </p>

      <ErrorText message={error} />

      <Announce
        burn={selected?.event}
        busy={busy}
        upload={api.uploadImage}
        people={people}
        onAnnounce={(title, body, done) => {
          if (eventId === undefined) return

          run(async () => {
            await api.addPost(eventId, { title, body })
            done()
          }, 'Could not announce that. Please try again.')
        }}
      />

      {loaded.status === 'loading' && <p class="form-note">One moment…</p>}
      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      {loaded.status === 'ready' && items.length === 0 && (
        <p class="form-note">Nothing has happened yet. It will show up here when it does.</p>
      )}

      {items.length > 0 && (
        <ul class="feed">
          {items.map((item) =>
            'line' in item ? (
              <li key={item.id} class="feed-line">
                <p class="feed-what">
                  {item.line.link === null ? (
                    item.line.body
                  ) : (
                    <a href={atItsBurn(item.line.link, item.line.event_id)}>{item.line.body}</a>
                  )}
                </p>
                <p class="feed-when">
                  {item.line.burn} · {localDay(item.line.created_at)}
                </p>
                <Chip
                  category={item.line.category}
                  on={settings?.on.includes(item.line.category) ?? false}
                  busy={busy}
                  onToggle={() => toggle(item.line.category)}
                />
              </li>
            ) : (
              <Card
                key={item.id}
                card={whole[item.card.id] ?? item.card}
                viewerId={viewer.account?.id}
                admin={isAdmin(viewer)}
                busy={busy}
                on={settings?.on}
                talk={talk}
                upload={api.uploadImage}
                people={people}
                onToggle={toggle}
              />
            ),
          )}
        </ul>
      )}
    </GuardedPage>
  )
}

const Mine = ({
  card,
  mine,
  busy,
  upload,
  people,
  onReword,
  onTakeBack,
}: {
  card: Thread
  mine: boolean
  busy: boolean
  upload: UploadImage
  people: readonly Mentionable[]
  onReword: (title: string, body: string, done: () => void) => void
  onTakeBack: () => void
}) => {
  const [editing, setEditing] = useState<{ title: string; body: string } | undefined>(undefined)

  if (editing === undefined) {
    return (
      <p class="row">
        {mine && (
          <button
            type="button"
            class="link-button"
            disabled={busy}
            onClick={() => setEditing({ title: card.title, body: card.body ?? '' })}
          >
            Reword it
          </button>
        )}
        <button
          type="button"
          class="link-button"
          disabled={busy}
          aria-label={`Take back ${card.title}`}
          onClick={onTakeBack}
        >
          Take it back
        </button>
      </p>
    )
  }

  return (
    <div class="form">
      <label class="field">
        <span>What is it</span>
        <input
          type="text"
          aria-label={`What ${card.title} is`}
          maxLength={MAX_TITLE}
          disabled={busy}
          value={editing.title}
          onInput={(inputEvent) => setEditing({ ...editing, title: inputEvent.currentTarget.value })}
        />
      </label>

      <MarkdownField
        label="Anything more"
        accessibleName={`What you want to say about ${card.title}`}
        value={editing.body}
        maxLength={MAX_POST}
        rows={4}
        upload={upload}
        people={people}
        onInput={(body) => setEditing({ ...editing, body })}
      />

      <p class="row">
        <button
          type="button"
          disabled={busy || editing.title.trim() === ''}
          onClick={() => onReword(editing.title.trim(), editing.body.trim(), () => setEditing(undefined))}
        >
          Save
        </button>
        <button type="button" class="link-button" disabled={busy} onClick={() => setEditing(undefined)}>
          Cancel
        </button>
      </p>
    </div>
  )
}

const Announce = ({
  burn,
  busy,
  upload,
  people,
  onAnnounce,
}: {
  burn: { id: string; name: string } | undefined
  busy: boolean
  upload: UploadImage
  people: readonly Mentionable[]
  onAnnounce: (title: string, body: string, done: () => void) => void
}) => {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  if (burn === undefined) return null

  if (!open) {
    return (
      <p class="row">
        <button type="button" class="link-button" disabled={busy} onClick={() => setOpen(true)}>
          Announce something
        </button>
      </p>
    )
  }

  return (
    <form
      class="form"
      onSubmit={(submitEvent) => {
        submitEvent.preventDefault()
        if (title.trim() === '') return

        onAnnounce(title.trim(), body.trim(), () => {
          setTitle('')
          setBody('')
          setOpen(false)
        })
      }}
    >
      <label class="field">
        <span>What is it</span>
        <input
          type="text"
          aria-label="What you are announcing"
          placeholder="The planning call is Sunday the 14th"
          maxLength={MAX_TITLE}
          disabled={busy}
          value={title}
          onInput={(inputEvent) => setTitle(inputEvent.currentTarget.value)}
        />
      </label>

      <MarkdownField
        label="Anything more"
        accessibleName="What you want to say about it"
        value={body}
        maxLength={MAX_POST}
        rows={4}
        upload={upload}
        people={people}
        onInput={setBody}
      />

      <p class="form-note">Everyone coming to {burn.name} will see this on the feed.</p>

      <p class="row">
        <button type="submit" disabled={busy || title.trim() === ''}>
          Announce it
        </button>
        <button type="button" class="link-button" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </p>
    </form>
  )
}

const feedItems = ({ activity, threads }: Happening): Item[] =>
  [
    ...activity.map((line) => ({ at: line.created_at, id: line.id, line })),
    ...threads.map((card) => ({ at: card.last_at ?? '', id: card.id, card })),
  ].sort((one, other) =>
    one.at === other.at ? other.id.localeCompare(one.id) : other.at.localeCompare(one.at),
  )

const Card = ({
  card,
  viewerId,
  admin,
  busy,
  on,
  talk,
  upload,
  people,
  onToggle,
}: {
  card: Thread
  viewerId: string | undefined
  admin: boolean
  busy: boolean
  on: readonly NotificationCategory[] | undefined
  talk: {
    say: (id: string, body: string) => void
    rewrite: (id: string, body: string) => void
    remove: (id: string) => void
    showAll: (id: string) => void
    reword: (threadId: string, id: string, title: string, body: string, done: () => void) => void
    takeBack: (threadId: string, id: string) => void
  }
  upload: UploadImage
  people: readonly Mentionable[]
  onToggle: (category: NotificationCategory) => void
}) => {
  const category = chipFor(card)

  return (
    <li class="feed-card">
      <p class="feed-card-head">
        {card.link === null ? <span>{card.title}</span> : <a href={card.link}>{card.title}</a>}
      </p>
      <p class="feed-when">
        {card.burn}
        {card.last_at !== null && ` · ${localDay(card.last_at)}`}
        {card.gone && goneLabel[card.entity_type]}
      </p>

      {card.body !== null && (
        <div
          class="markdown-preview feed-card-about"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(card.body) }}
        />
      )}

      {(card.own || (admin && card.entity_type === 'post')) && !card.gone && (
        <Mine
          card={card}
          mine={card.own}
          busy={busy}
          upload={upload}
          people={people}
          onReword={(title, body, done) => talk.reword(card.id, card.entity_id, title, body, done)}
          onTakeBack={() => talk.takeBack(card.id, card.entity_id)}
        />
      )}

      <DreamThread
        thread={card}
        viewerId={viewerId}
        admin={admin}
        busy={busy}
        more={card.entry_count > card.entries.length}
        upload={upload}
        people={people}
        onSay={(body) => talk.say(card.id, body)}
        onRewrite={(id, body) => talk.rewrite(id, body)}
        onRemove={(id) => talk.remove(id)}
        onShowAll={() => talk.showAll(card.id)}
      />

      {category !== undefined && (
        <Chip
          category={category}
          on={on?.includes(category) ?? false}
          busy={busy}
          onToggle={() => onToggle(category)}
        />
      )}
    </li>
  )
}

const goneLabel = {
  session: ' · withdrawn',
  attendance: ' · no longer coming',
  post: ' · taken back',
} as const satisfies Record<Thread['entity_type'], string>

const chipFor = (card: Thread): NotificationCategory | undefined =>
  card.entries.reduceRight<NotificationCategory | undefined>(
    (found, entry) => found ?? entryCategory(card.entity_type, entry.kind),
    undefined,
  )

const atItsBurn = (link: string, eventId: string) => {
  const hash = link.indexOf('#')
  const path = hash === -1 ? link : link.slice(0, hash)
  const fragment = hash === -1 ? undefined : link.slice(hash + 1)
  const joined = `${path}${path.includes('?') ? '&' : '?'}${BURN_PARAM}=${encodeURIComponent(eventId)}`

  return fragment === undefined ? joined : `${joined}#${fragment}`
}

const Chip = ({
  category,
  on,
  busy,
  onToggle,
}: {
  category: NotificationCategory
  on: boolean
  busy: boolean
  onToggle: () => void
}) => (
  <button
    type="button"
    class={on ? 'feed-chip is-on' : 'feed-chip'}
    aria-pressed={on}
    disabled={busy}
    title={on ? 'You are told about these. Tap to stop.' : 'Tell me about these'}
    onClick={onToggle}
  >
    {notificationCategoryInfo[category].label}
    {on && ' 🔔'}
  </button>
)
