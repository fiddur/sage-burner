import type { NotificationCategory, NotificationsResponse } from '@sage-burner/shared'

import { notificationCategoryInfo } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from './api/client.ts'

import { isApiError } from './api/client.ts'

export type NotificationRowApi = Pick<
  ApiClient,
  'deleteMyNotification' | 'getMyNotificationSettings' | 'updateMyNotificationSettings'
>

export interface NotificationRowActions {
  busy: boolean
  error: string | undefined
  note: string | undefined
  stop: (category: NotificationCategory) => void
  remove: (id: string) => void
}

export const useNotificationRows = (
  api: NotificationRowApi,
  after: (answered: NotificationsResponse | undefined) => void,
): NotificationRowActions => {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [note, setNote] = useState<string | undefined>(undefined)

  const run = (work: () => Promise<NotificationsResponse | undefined>, fallback: string, said?: string) => {
    setBusy(true)
    setError(undefined)
    setNote(undefined)
    work()
      .then((answered) => {
        after(answered)
        if (said !== undefined) setNote(said)
      })
      .catch((failure: unknown) => setError(isApiError(failure) ? failure.message : fallback))
      .finally(() => setBusy(false))
  }

  return {
    busy,
    error,
    note,
    stop: (category) => {
      run(
        async () => {
          const held = await api.getMyNotificationSettings()
          await api.updateMyNotificationSettings({
            on: held.on.filter((one) => one !== category),
            email: held.email.filter((one) => one !== category),
            digest: held.digest,
          })

          return undefined
        },
        'Could not switch that off. Please try again.',
        `Switched off: “${notificationCategoryInfo[category].label}”. Your details has it back on again.`,
      )
    },
    remove: (id) => {
      run(async () => await api.deleteMyNotification(id), 'Could not remove that. Please try again.')
    },
  }
}
