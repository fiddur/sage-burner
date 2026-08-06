import type { NotificationCategory } from '@sage-burner/shared'

import { notificationCategories, notificationCategoryLabels } from '@sage-burner/shared'
import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { FormError, useFormError } from './FormError.tsx'

export type NotificationSettingsApi = Pick<
  ApiClient,
  'getMyNotificationSettings' | 'updateMyNotificationSettings'
>

/**
 * Which of the six a member wants to hear about.
 *
 * Ticked means notify, and every box starts ticked — what is stored is the *unticked*
 * ones, so a new account needs nothing seeded and the default cannot drift from what
 * this renders.
 *
 * Saved on each tick rather than behind a button: there is nothing to review and no
 * way to be half-done, and a settings table with a Save nobody presses is a table
 * that quietly does not apply.
 */
export const NotificationSettingsField = ({ api }: { api: NotificationSettingsApi }) => {
  const [muted, setMuted] = useState<readonly NotificationCategory[] | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useFormError()

  useEffect(() => {
    const controller = new AbortController()

    api
      .getMyNotificationSettings(controller.signal)
      .then(({ muted: off }) => {
        if (!controller.signal.aborted) setMuted(off)
      })
      .catch(() => {
        if (!controller.signal.aborted) setMuted([])
      })

    return () => controller.abort()
  }, [api])

  if (muted === undefined) return <p class="form-note">Loading…</p>

  const set = async (category: NotificationCategory, notify: boolean) => {
    const wanted = notify ? muted.filter((one) => one !== category) : [...muted, category]

    setBusy(true)
    setError(undefined)
    // Moved before the request, so a tick is immediate; put back on failure, since a
    // box showing a setting that was refused is worse than one that did not move.
    setMuted(wanted)
    try {
      setMuted((await api.updateMyNotificationSettings({ muted: [...wanted] })).muted)
    } catch (failure) {
      setMuted(muted)
      setError(isApiError(failure) ? failure.message : 'Could not save that. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <FormError error={error} />

      <table class="table">
        <thead>
          <tr>
            <th scope="col">What happened</th>
            <th scope="col">Notify me</th>
          </tr>
        </thead>
        <tbody>
          {notificationCategories.map((category) => (
            <tr key={category}>
              <th scope="row">{notificationCategoryLabels[category]}</th>
              <td>
                <input
                  type="checkbox"
                  disabled={busy}
                  aria-label={notificationCategoryLabels[category]}
                  checked={!muted.includes(category)}
                  onChange={(changeEvent) => void set(category, changeEvent.currentTarget.checked)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
