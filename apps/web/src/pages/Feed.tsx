import type { Activity, NotificationCategory, NotificationSettings } from '@sage-burner/shared'

import { notificationCategoryInfo } from '@sage-burner/shared'

import type { ApiClient } from '../api/client.ts'

import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { Refreshing } from '../components/Refreshing.tsx'
import { localDay } from '../datetime.ts'
import { useAction, useLoad } from '../load.ts'
import { isApproved, useViewer } from '../viewer.tsx'

export type FeedApi = Pick<
  ApiClient,
  'getFeed' | 'getMyNotificationSettings' | 'updateMyNotificationSettings'
>

interface Happening {
  activity: readonly Activity[]
  settings: NotificationSettings
}

/**
 * What everyone has been doing (#303). `docs/the-app.md` has the why.
 *
 * The lines are the burn-wide notifications, shown to everybody rather than only to
 * whoever switched that category on — and across burns, so each says which it belongs
 * to. Reading it writes nothing: the bell and its unseen count stay `notification`'s.
 */
export const Feed = ({ api }: { api: FeedApi }) => {
  const approved = isApproved(useViewer())
  const { loaded, refreshing, reload } = useLoad<Happening>(
    async (signal) => {
      const [feed, settings] = await Promise.all([api.getFeed(signal), api.getMyNotificationSettings(signal)])

      return { activity: feed.activity, settings }
    },
    { enabled: approved, fallback: 'Could not load what has been going on.' },
  )

  const { busy, error, run } = useAction(reload)

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

  return (
    <GuardedPage title="Going on" require="approved">
      <h1>
        Going on <Refreshing on={refreshing} />
      </h1>

      <p class="form-note">
        What people have been doing, newest first. Tap what a line is about to be told about the next one at a
        burn you are coming to — the same switch as the one on <a href="/profile">your details</a>.
      </p>

      <ErrorText message={error} />

      {loaded.status === 'loading' && <p class="form-note">One moment…</p>}
      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      {loaded.status === 'ready' && loaded.data.activity.length === 0 && (
        <p class="form-note">Nothing has happened yet. It will show up here when it does.</p>
      )}

      {loaded.status === 'ready' && loaded.data.activity.length > 0 && (
        <ul class="feed">
          {loaded.data.activity.map((line) => (
            <li key={line.id} class="feed-line">
              <p class="feed-what">{line.link === null ? line.body : <a href={line.link}>{line.body}</a>}</p>
              <p class="feed-when">
                {line.burn} · {localDay(line.created_at)}
              </p>
              <Chip
                category={line.category}
                on={loaded.data.settings.on.includes(line.category)}
                busy={busy}
                onToggle={() => toggle(line.category)}
              />
            </li>
          ))}
        </ul>
      )}
    </GuardedPage>
  )
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
