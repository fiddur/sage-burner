import { useEffect, useRef } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { PushBrowser } from '../push.ts'

import { BellNudge } from '../components/BellNudge.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { NotificationList } from '../components/NotificationList.tsx'
import { Refreshing } from '../components/Refreshing.tsx'
import { useLoad } from '../load.ts'
import { useNotificationRows } from '../notification-rows.ts'
import { isMember, useViewer } from '../viewer.tsx'

export type NotificationsApi = Pick<
  ApiClient,
  | 'deleteMyNotification'
  | 'getMyNotifications'
  | 'getMyNotificationSettings'
  | 'markNotificationsSeen'
  | 'updateMyNotificationSettings'
  | 'getPushKey'
  | 'subscribeToPush'
  | 'unsubscribeFromPush'
>

export const Notifications = ({
  api,
  browser,
}: {
  api: NotificationsApi
  browser?: PushBrowser | undefined
}) => {
  const viewer = useViewer()
  const signedIn = viewer.account !== undefined
  const { loaded, refreshing, reload } = useLoad(async (signal) => await api.getMyNotifications(signal), {
    enabled: signedIn,
    fallback: 'Could not load what has happened. Please reload the page.',
    live: true,
  })

  const unseen = loaded.status === 'ready' ? loaded.data.unseen : 0

  useEffect(() => {
    if (unseen === 0) return

    api.markNotificationsSeen().catch(() => undefined)
  }, [api, unseen])

  const rows = useNotificationRows(api, () => void reload())

  const arrivedNew = useRef<Set<string>>(new Set())

  const items = loaded.status === 'ready' ? loaded.data.notifications : []
  for (const item of items) if (item.seen_at === null) arrivedNew.current.add(item.id)

  const asRead = items.map((item) => (arrivedNew.current.has(item.id) ? { ...item, seen_at: null } : item))

  return (
    <GuardedPage title="Notifications" require="signed-in" width="column">
      <h1>
        Notifications <Refreshing on={refreshing} />
      </h1>

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

      <ErrorText message={rows.error} />
      {rows.note !== undefined && (
        <p class="form-note" role="status">
          {rows.note}
        </p>
      )}

      {loaded.status === 'ready' && (
        <NotificationList items={asRead} busy={rows.busy} onStop={rows.stop} onRemove={rows.remove} />
      )}

      <BellNudge api={api} browser={browser} />
    </GuardedPage>
  )
}
