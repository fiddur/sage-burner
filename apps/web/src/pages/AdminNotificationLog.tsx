import type { NotificationLogEntry } from '@sage-burner/shared'

import { notificationCategoryInfo } from '@sage-burner/shared'

import type { ApiClient } from '../api/client.ts'

import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { Table } from '../components/Table.tsx'
import { localDay } from '../datetime.ts'
import { useLoad } from '../load.ts'
import { isAdmin, useViewer } from '../viewer.tsx'

export type NotificationLogApi = Pick<ApiClient, 'getNotificationLog'>

export const when = (iso: string): string => {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso

  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`

  return `${localDay(iso)} ${time}`
}

export const firstLine = (body: string): string => body.split('\n')[0] ?? body

export const devices = (entry: NotificationLogEntry): string => {
  const tried = entry.accepted + entry.failed + entry.gone

  return tried === 0 ? 'none registered' : `${entry.accepted} of ${tried}`
}

export const AdminNotificationLog = ({ api }: { api: NotificationLogApi }) => {
  const admin = isAdmin(useViewer())
  const { loaded } = useLoad((signal) => api.getNotificationLog(signal), {
    enabled: admin,
    fallback: 'Could not load the notification log.',
  })

  return (
    <GuardedPage title="Notifications sent" require="admin">
      <h1>Notifications sent</h1>

      <p class="form-note">
        One line per notification the app generated, newest first. <strong>Taken</strong> counts the browsers
        whose push service accepted it — not the people who saw it, which nothing here can know. Somebody who
        has the category switched off is counted under <strong>Off</strong> and told nothing.
      </p>

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}

      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      {loaded.status === 'ready' && loaded.data.entries.length === 0 && (
        <p class="form-note">Nothing has gone out yet.</p>
      )}

      {loaded.status === 'ready' && loaded.data.entries.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">About</th>
              <th scope="col">Said</th>
              <th scope="col">Told</th>
              <th scope="col">Off</th>
              <th scope="col">Taken</th>
              <th scope="col">Emails</th>
            </tr>
          </thead>
          <tbody>
            {loaded.data.entries.map((entry) => (
              <tr key={entry.id}>
                <td>{when(entry.created_at)}</td>
                <td>{notificationCategoryInfo[entry.category].label}</td>
                <td>{firstLine(entry.body)}</td>
                <td>{entry.told}</td>
                <td>{entry.suppressed}</td>
                <td>{devices(entry)}</td>
                <td>{entry.emailed}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </GuardedPage>
  )
}
