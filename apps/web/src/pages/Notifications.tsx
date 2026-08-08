import { useEffect, useRef } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { NotificationList } from '../components/NotificationList.tsx'
import { Refreshing } from '../components/Refreshing.tsx'
import { useLoad } from '../load.ts'
import { isMember, useViewer } from '../viewer.tsx'

export type NotificationsApi = Pick<ApiClient, 'getMyNotifications' | 'markNotificationsSeen'>

/**
 * What has happened to you, as a page (#336).
 *
 * The bell's panel hung off a button whose x-position moved: wrapped onto the header's
 * second row it opened past the edge of a phone and could not be reached at all. On a
 * phone the bell is a link to here instead, so there is no panel to misplace — and a
 * tapped push lands somewhere a reader can scroll, share and come back to.
 *
 * **Reading it marks everything seen**, exactly as opening the panel does, and that is
 * the whole of what seen means here. The marking is for the next visit: what arrived
 * new stays bold for as long as this page is open, because taking the emphasis away in
 * front of somebody would undo the thing they came to look at.
 *
 * That is what `arrivedNew` is for. The page keeps the bell's beat so a tab left open
 * catches up — and every one of those refetches comes back with `seen_at` set on the
 * rows this page just marked, so without it the bold would vanish a minute in, or the
 * moment the tab was focused. It only ever *grows*: one that arrives while the page is
 * open is new on the answer that brings it and stays new through the next, which is the
 * same promise as for the ones that were there on opening.
 */
export const Notifications = ({ api }: { api: NotificationsApi }) => {
  const viewer = useViewer()
  const signedIn = viewer.account !== undefined
  const { loaded, refreshing } = useLoad(async (signal) => await api.getMyNotifications(signal), {
    enabled: signedIn,
    fallback: 'Could not load what has happened. Please reload the page.',
    // The same beat the bell polls on, so a page left open catches up rather than
    // going quietly stale beside a bubble that is counting.
    live: true,
  })

  const unseen = loaded.status === 'ready' ? loaded.data.unseen : 0

  useEffect(() => {
    if (unseen === 0) return

    // Swallowed, like the bell's: the worst a failure costs is a bubble that is still
    // there on the next ask, and an error where a page goes would be worse.
    api.markNotificationsSeen().catch(() => undefined)
  }, [api, unseen])

  // A ref rather than state: nothing should re-render because of it, and it is written
  // during the render that reads the answer it describes.
  const arrivedNew = useRef<Set<string>>(new Set())

  const items = loaded.status === 'ready' ? loaded.data.notifications : []
  for (const item of items) if (item.seen_at === null) arrivedNew.current.add(item.id)

  const asRead = items.map((item) => (arrivedNew.current.has(item.id) ? { ...item, seen_at: null } : item))

  return (
    <GuardedPage title="Notifications" require="signed-in">
      <h1>
        Notifications <Refreshing on={refreshing} />
      </h1>

      {/* The link only to a member: the details page is theirs, and pointing an
          applicant at a page that refuses them is worse than saying nothing. */}
      <p class="form-note">
        What has happened to you, newest first.
        {isMember(viewer) && (
          <>
            {' '}
            Which of these reach you is on <a href="/profile">your details</a>.
          </>
        )}
      </p>

      {loaded.status === 'loading' && <p class="form-note">One moment…</p>}
      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      {loaded.status === 'ready' && <NotificationList items={asRead} />}
    </GuardedPage>
  )
}
