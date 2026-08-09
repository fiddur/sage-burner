import type { Activity, NotificationCategory, NotificationSettings, Thread } from '@sage-burner/shared'

import { BURN_PARAM, dreamPage, entryCategory, notificationCategoryInfo } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { DreamThread } from '../components/DreamThread.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { Refreshing } from '../components/Refreshing.tsx'
import { localDay } from '../datetime.ts'
import { useAction, useLoad } from '../load.ts'
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
>

interface Happening {
  activity: readonly Activity[]
  threads: readonly Thread[]
  settings: NotificationSettings
}

/** One thing on the page: something that happened, or somewhere people are talking. */
type Item = { at: string; id: string } & ({ line: Activity } | { card: Thread })

/**
 * The feed — what everyone has been doing (#303) and what they are talking about (#375).
 * `docs/the-app.md` has the why.
 *
 * **Two things on one page, deliberately.** A dream is one card carrying its whole
 * history and the talk under it, so a morning of four comments is not four lines; the
 * burn's own news — somebody joined, a lead role taken — stays a line, because collapsing
 * that by thread would put the lot behind one card per burn. The server has already
 * merged and cut them to fifty; this interleaves by time.
 *
 * **A card is the conversation, not a preview of one.** It is also the only place a
 * withdrawn dream's thread can be read, since there is no panel left to open.
 *
 * **Each link carries the burn it is about** (#333). The links are burn-agnostic —
 * `/dreams`, `/members`, `/roles` — so following one about the autumn burn while the
 * selector sat on the summer one opened the summer page. Added here rather than stored
 * on the row, so the lines already written land right too; `burn.tsx` is what reads it.
 */
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

  // Whichever threads somebody has opened out, keyed by id. The card carries its newest
  // few lines; this is what replaces them once the whole conversation has been asked
  // for. Cleared by nothing: a reload refreshes what is held rather than closing it.
  const [whole, setWhole] = useState<Record<string, Thread>>({})

  const settings = loaded.status === 'ready' ? loaded.data.settings : undefined

  /**
   * The chip's whole job: switch this category's bell on, or off again.
   *
   * The wire carries the complete set, so what is sent is what is held plus or minus
   * one — the same shape the settings table sends (#259).
   */
  const toggle = (category: NotificationCategory) => {
    if (settings === undefined) return

    const on = settings.on.includes(category)
    const wanted = {
      on: on ? settings.on.filter((one) => one !== category) : [...settings.on, category],
      email: [...settings.email],
    }

    run(() => api.updateMyNotificationSettings(wanted), 'Could not change that. Please try again.')
  }

  /** Every write here answers with the thread it changed, so nothing needs a second read. */
  const held = (thread: Thread) => {
    setWhole((sofar) => ({ ...sofar, [thread.id]: thread }))
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
  }

  const items = loaded.status === 'ready' ? feedItems(loaded.data) : []

  return (
    <GuardedPage title="Feed" require="approved">
      <h1>
        Feed <Refreshing on={refreshing} />
      </h1>

      <p class="form-note">
        What people have been doing and saying, newest first. Say something on a dream and it comes back to
        the top. Tap what a line is about to be told about the next one at a burn you are coming to — the same
        switch as the one on <a href="/profile">your details</a>.
      </p>

      <ErrorText message={error} />

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
                onToggle={toggle}
              />
            ),
          )}
        </ul>
      )}
    </GuardedPage>
  )
}

/**
 * Both halves in one order.
 *
 * The server has already cut them to fifty against each other; this only has to
 * interleave. Newest first, with the id breaking a shared stamp for the reason the
 * server's own query does: an order that changes between two reads of the same data
 * reads as though something happened twice.
 */
const feedItems = ({ activity, threads }: Happening): Item[] =>
  [
    ...activity.map((line) => ({ at: line.created_at, id: line.id, line })),
    ...threads.map((card) => ({ at: card.last_at, id: card.id, card })),
  ].sort((one, other) =>
    one.at === other.at ? other.id.localeCompare(one.id) : other.at.localeCompare(one.at),
  )

/**
 * One conversation on the page: what it is about, and everything said about it.
 *
 * The heading is the thread's own title, which the rename keeps in step — the bug this
 * replaced was a line frozen at the wording a dream was offered under.
 */
const Card = ({
  card,
  viewerId,
  admin,
  busy,
  on,
  talk,
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
  }
  onToggle: (category: NotificationCategory) => void
}) => {
  const page = pageFor(card)
  const category = chipFor(card)

  return (
    <li class="feed-card">
      <p class="feed-card-head">
        {page === undefined ? <span>{card.title}</span> : <a href={page}>{card.title}</a>}
      </p>
      <p class="feed-when">
        {card.burn} · {localDay(card.last_at)}
        {card.gone && ' · withdrawn'}
      </p>

      <DreamThread
        thread={card}
        viewerId={viewerId}
        admin={admin}
        busy={busy}
        more={card.entry_count > card.entries.length}
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

/**
 * Where the thing a thread is about lives, or nothing once it has gone.
 *
 * The link builder `entity_type` exists for: a meal or a ride becomes a branch here and
 * a value in the vocabulary, rather than a migration.
 */
const pageFor = (card: Thread): string | undefined =>
  card.gone ? undefined : dreamPage(card.event_id, card.entity_id)

/**
 * The switch this card offers, which is what the top of it is.
 *
 * The newest line that names a category somebody could actually be told through — a
 * dream being moved sends nothing, so a card whose latest news is a move offers no chip
 * rather than one that would change nothing.
 */
const chipFor = (card: Thread): NotificationCategory | undefined =>
  card.entries.reduceRight<NotificationCategory | undefined>(
    (found, entry) => found ?? entryCategory(entry.kind),
    undefined,
  )

/**
 * The same page, about the burn the line belongs to rather than whichever is selected.
 *
 * Cut at the first `#`: no notification link carries a fragment today, and appending to
 * one would put the query inside it, where it is not a query at all. `split` would drop
 * everything past a second `#`.
 */
const atItsBurn = (link: string, eventId: string) => {
  const hash = link.indexOf('#')
  const path = hash === -1 ? link : link.slice(0, hash)
  const fragment = hash === -1 ? undefined : link.slice(hash + 1)
  const joined = `${path}${path.includes('?') ? '&' : '?'}${BURN_PARAM}=${encodeURIComponent(eventId)}`

  return fragment === undefined ? joined : `${joined}#${fragment}`
}

/**
 * What kind of thing this is, and the door onto the setting for it.
 *
 * Half the point of the page: this is where somebody discovers the switch exists, in
 * the moment they have just found the thing interesting — which is a better place for
 * it than a table of eleven rows they went looking for.
 *
 * The label is the settings table's own, rather than a second vocabulary to keep in
 * step. A toggle button rather than a link, because it changes something: `aria-pressed`
 * is what says which way it is set.
 */
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
