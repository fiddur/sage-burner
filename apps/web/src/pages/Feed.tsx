import type { NotificationCategory, NotificationSettings, Thread } from '@sage-burner/shared'

import {
  BURN_PARAM,
  entryCategory,
  feedKindLabel,
  feedKinds,
  feedKindsFrom,
  feedPage,
  KINDS_PARAM,
  MAX_POST,
  MAX_TITLE,
} from '@sage-burner/shared'
import { useLocation } from 'preact-iso'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { UploadImage } from '../image-upload.ts'
import type { Mentionable } from '../mentioning.ts'

import { isApiError } from '../api/client.ts'
import { useSelectedBurn } from '../burn.tsx'
import { CardBell } from '../components/CardBell.tsx'
import { ChipRow } from '../components/ChipRow.tsx'
import { Destroy } from '../components/Destroy.tsx'
import { DreamThread } from '../components/DreamThread.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { Heart } from '../components/Heart.tsx'
import { MarkdownField } from '../components/MarkdownField.tsx'
import { Refreshing } from '../components/Refreshing.tsx'
import { localDay } from '../datetime.ts'
import { errorMessage, useAction, useLoad } from '../load.ts'
import { renderMarkdown } from '../markdown.ts'
import { usePushNudge } from '../push-nudge.tsx'
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
  | 'getApprovedAccounts'
  | 'supportThread'
  | 'withdrawSupportForThread'
  | 'setThreadFollow'
>

interface Happening {
  threads: readonly Thread[]
  settings: NotificationSettings
}

export const Feed = ({ api }: { api: FeedApi }) => {
  const viewer = useViewer()
  const approved = isApproved(viewer)
  const { query, route } = useLocation()
  const asked: string | undefined = query?.[KINDS_PARAM]
  const lit = feedKindsFrom(asked)
  const { loaded, refreshing, reload } = useLoad<Happening>(
    async (signal) => {
      const [feed, settings] = await Promise.all([
        api.getFeed(lit, signal),
        api.getMyNotificationSettings(signal),
      ])

      return { threads: feed.threads, settings }
    },
    { enabled: approved, key: lit.join(','), fallback: 'Could not load what has been going on.' },
  )

  const { busy, error, run } = useAction(reload)

  const [whole, setWhole] = useState<Record<string, Thread>>({})

  const settings = loaded.status === 'ready' ? loaded.data.settings : undefined

  const { askAbout } = usePushNudge()

  const toggle = (category: NotificationCategory) => {
    if (settings === undefined) return

    const on = settings.on.includes(category)
    const wanted = {
      on: on ? settings.on.filter((one) => one !== category) : [...settings.on, category],
      email: [...settings.email],
      digest: settings.digest,
    }

    if (!on) askAbout()

    run(() => api.updateMyNotificationSettings(wanted), 'Could not change that. Please try again.')
  }

  const held = (thread: Thread) => {
    setWhole((sofar) => ({ ...sofar, [thread.id]: thread }))
  }

  const heldKeepingFold = (shown: Thread, fresh: Thread) => {
    held({ ...fresh, entries: shown.entries, entry_count: shown.entry_count })
  }

  const forget = (threadId: string) => {
    setWhole(({ [threadId]: _gone, ...rest }) => rest)
  }

  /**
   * Every write a card offers, with the one answer a soft delete never gave: a 404 means the
   * thing itself has gone since the page was drawn (#614). The card goes with it and the page
   * says which, rather than leaving a composer over something nobody has.
   */
  const onCard = (card: Thread, work: () => Promise<unknown>, fallback: string) => {
    run(
      async () => {
        try {
          await work()
        } catch (failure) {
          if (isGone(failure)) {
            forget(card.id)
            await reload()
          }

          throw failure
        }
      },
      (failure) => (isGone(failure) ? wentAway[card.entity_type] : errorMessage(failure, fallback)),
    )
  }

  // A comment's 404 is a different loss from the card's: no `forget`, no `reload` (#683).
  const onComment = (card: Thread, work: () => Promise<unknown>, fallback: string) => {
    let entityGone = false

    const settle = async () => {
      try {
        held((await api.getThread(card.id)).thread)
      } catch (second) {
        if (!isGone(second)) return

        entityGone = true
        forget(card.id)
        await reload()
      }
    }

    run(
      async () => {
        try {
          await work()
        } catch (failure) {
          if (isGone(failure)) await settle()

          throw failure
        }
      },
      (failure) => {
        if (!isGone(failure)) return errorMessage(failure, fallback)

        return entityGone ? wentAway[card.entity_type] : GONE_COMMENT
      },
    )
  }

  const talk = {
    say: (card: Thread, body: string, done: () => void) => {
      onCard(
        card,
        async () => {
          held((await api.postComment(card.id, { body })).thread)
          done()
        },
        'Could not say that.',
      )
    },
    rewrite: (card: Thread, id: string, body: string) => {
      onComment(
        card,
        async () => held((await api.updateComment(id, { body })).thread),
        'Could not save that.',
      )
    },
    remove: (card: Thread, id: string) => {
      onComment(card, async () => held((await api.deleteComment(id)).thread), 'Could not take that back.')
    },
    showAll: (card: Thread) => {
      onCard(card, async () => held((await api.getThread(card.id)).thread), 'Could not load the rest of it.')
    },
    follow: (card: Thread, following: boolean) => {
      onCard(
        card,
        async () => heldKeepingFold(card, (await api.setThreadFollow(card.id, { following })).thread),
        'Could not change that. Please try again.',
      )
    },
    heart: (card: Thread, hearting: boolean) => {
      onCard(
        card,
        async () =>
          heldKeepingFold(
            card,
            (hearting ? await api.supportThread(card.id) : await api.withdrawSupportForThread(card.id))
              .thread,
          ),
        'Could not do that just now.',
      )
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

  const cards = loaded.status === 'ready' ? loaded.data.threads : []
  const selected = useSelectedBurn()
  const eventId = selected?.event.id

  const { loaded: coming } = useLoad(
    async (signal) => (eventId === undefined ? [] : (await api.getEventAttendees(eventId, signal)).attendees),
    {
      enabled: approved && eventId !== undefined,
      key: eventId ?? '',
      fallback: 'Could not load who is coming.',
    },
  )
  const people = coming.status === 'ready' ? coming.data : []

  const { loaded: everybody } = useLoad(async (signal) => (await api.getApprovedAccounts(signal)).accounts, {
    enabled: approved,
    fallback: 'Could not load who is here.',
  })
  const members = everybody.status === 'ready' ? everybody.data : []

  // Whom a comment can name depends on the card: the burn's attendance for a burn's card, and
  // every approved account for one that belongs to no burn — `namedBy` drops the rest silently.
  const mentionable = (card: Thread): readonly Mentionable[] => {
    if (card.entity_type === 'song') return members

    return card.event_id === eventId ? people : []
  }

  return (
    <GuardedPage title="Feed" require="approved" width="column">
      <h1>
        Feed <Refreshing on={refreshing} />
      </h1>

      <p class="form-note">
        What people have been doing and saying, newest first. Say something on a card and it comes back to the
        top. The 🔔 in its corner is where you say whether to be told about replies to it, and about the next
        one like it at a burn you are coming to — the same switch as the one on{' '}
        <a href="/profile">your details</a>.
      </p>

      <ChipRow
        chips={feedKinds.map((kind) => ({ id: kind, label: feedKindLabel[kind] }))}
        lit={lit}
        subject="What to show"
        onChange={(wanted) => route(feedPage(wanted, query?.[BURN_PARAM]))}
      />

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

      {loaded.status === 'ready' && cards.length === 0 && (
        <p class="form-note">Nothing has happened yet. It will show up here when it does.</p>
      )}

      {cards.length > 0 && (
        <ul class="feed">
          {cards.map((item) => (
            <Card
              key={item.id}
              card={whole[item.id] ?? item}
              viewerId={viewer.account?.id}
              admin={isAdmin(viewer)}
              busy={busy}
              on={settings?.on}
              talk={talk}
              upload={api.uploadImage}
              people={mentionable(item)}
              onToggle={toggle}
            />
          ))}
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
        <Destroy what={card.title} verb="Take back" busy={busy} onDestroy={onTakeBack} />
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
    say: (card: Thread, body: string, done: () => void) => void
    rewrite: (card: Thread, id: string, body: string) => void
    remove: (card: Thread, id: string) => void
    showAll: (card: Thread) => void
    reword: (threadId: string, id: string, title: string, body: string, done: () => void) => void
    takeBack: (threadId: string, id: string) => void
    heart: (card: Thread, hearting: boolean) => void
    follow: (card: Thread, following: boolean) => void
  }
  upload: UploadImage
  people: readonly Mentionable[]
  onToggle: (category: NotificationCategory) => void
}) => {
  const category = chipFor(card)

  return (
    <li class="feed-card">
      <CardBell
        what={card.title}
        category={category}
        on={category !== undefined && (on?.includes(category) ?? false)}
        following={card.followed_by_me}
        busy={busy}
        onToggle={() => category !== undefined && onToggle(category)}
        onFollow={(following) => talk.follow(card, following)}
      />

      <p class="feed-card-head">
        {card.link === null ? <span>{card.title}</span> : <a href={card.link}>{card.title}</a>}
      </p>
      <p class="feed-when">
        {[whereItBelongs(card), card.last_at === null ? undefined : localDay(card.last_at)]
          .filter((part) => part !== undefined)
          .join(' · ')}
        {card.gone && goneLabel[card.entity_type]}
      </p>

      {card.body !== null && (
        <div
          class="markdown-preview feed-card-about"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(card.body) }}
        />
      )}

      {card.entity_type === 'post' && (card.own || admin) && !card.gone && (
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
        onSay={(body, done) => talk.say(card, body, done)}
        onRewrite={(id, body) => talk.rewrite(card, id, body)}
        onRemove={(id) => talk.remove(card, id)}
        onShowAll={() => talk.showAll(card)}
      />

      {!card.gone && (
        <p class="feed-card-foot">
          <Heart
            what={card.title}
            hearted={card.supported_by_me}
            count={card.support_count}
            busy={busy}
            onHeart={(hearting) => talk.heart(card, hearting)}
          />
        </p>
      )}
    </li>
  )
}

/** What a 404 from a card's own routes means, in the words each kind is taken away in. */
const wentAway = {
  session: 'Somebody withdrew that dream. It is off the page now.',
  attendance: 'They are no longer coming. Their card is off the page now.',
  post: 'Somebody took that announcement back. It is off the page now.',
  song: 'Somebody took that out of the songbook. It is off the page now.',
  bring: 'Somebody took that off the bring list. It is off the page now.',
  point: 'Somebody took that point off. It is off the page now.',
  meeting: 'Somebody took that out of the diary. It is off the page now.',
  role: 'Somebody took that role off. It is off the page now.',
  meal: 'Somebody took that sitting off the plan. It is off the page now.',
} as const satisfies Record<Thread['entity_type'], string>

const GONE_COMMENT = 'That comment is no longer there.'

const goneLabel = {
  session: ' · withdrawn',
  attendance: ' · no longer coming',
  post: ' · taken back',
  song: ' · out of the book',
  bring: ' · off the list',
  point: ' · taken off',
  meeting: ' · out of the diary',
  role: ' · no longer a role',
  meal: ' · off the plan',
} as const satisfies Record<Thread['entity_type'], string>

const isGone = (failure: unknown): boolean => isApiError(failure) && failure.status === 404

const whereItBelongs = (card: Thread): string | undefined =>
  card.burn ?? (card.entity_type === 'song' ? 'Songbook' : undefined)

const chipFor = (card: Thread): NotificationCategory | undefined =>
  card.entries.reduceRight<NotificationCategory | undefined>(
    (found, entry) => found ?? entryCategory(card.entity_type, entry.kind),
    undefined,
  )
