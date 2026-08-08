import { useEffect } from 'preact/hooks'

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
 * the whole of what seen means here. The list it was read with stays on screen with
 * the new ones still bold: the marking is for the next visit, and taking the emphasis
 * away in front of somebody would undo the thing they came to look at.
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

      {loaded.status === 'ready' && <NotificationList items={loaded.data.notifications} />}
    </GuardedPage>
  )
}
