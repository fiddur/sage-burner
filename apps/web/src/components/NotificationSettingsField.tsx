import type { NotificationCategory } from '@sage-burner/shared'

import { categoriesAbout, notificationCategoryInfo, notificationSections } from '@sage-burner/shared'
import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { FormError, useFormError } from './FormError.tsx'

export type NotificationSettingsApi = Pick<
  ApiClient,
  'getMyNotificationSettings' | 'updateMyNotificationSettings'
>

/**
 * Which happenings a member wants to hear about.
 *
 * Ticked means notify. **The defaults are not all the same**, which is why the wire
 * carries what is on rather than what is off: what happens to you is on unless you
 * refuse it, and what happens around you is off unless you ask (#259). The server
 * fills the defaults in, so nothing here has to know them — a second copy of a
 * default is a default that drifts.
 *
 * Two sections, from `notificationSections`. The split is a property of the category
 * and lives beside its label, so adding one cannot land it in the wrong half here.
 *
 * Saved on each tick rather than behind a button: there is nothing to review and no
 * way to be half-done, and a settings table with a Save nobody presses is a table
 * that quietly does not apply.
 */
export const NotificationSettingsField = ({ api }: { api: NotificationSettingsApi }) => {
  const [on, setOn] = useState<readonly NotificationCategory[] | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useFormError()

  useEffect(() => {
    const controller = new AbortController()

    api
      .getMyNotificationSettings(controller.signal)
      .then((settings) => {
        if (!controller.signal.aborted) setOn(settings.on)
      })
      .catch(() => {
        // Nothing rather than everything: a failed read must not draw a table of
        // ticks that would switch six categories off the moment one is touched.
        if (!controller.signal.aborted) setOn([])
      })

    return () => controller.abort()
  }, [api])

  if (on === undefined) return <p class="form-note">Loading…</p>

  const set = async (category: NotificationCategory, notify: boolean) => {
    const wanted = notify ? [...on, category] : on.filter((one) => one !== category)

    setBusy(true)
    setError(undefined)
    // Moved before the request, so a tick is immediate; put back on failure, since a
    // box showing a setting that was refused is worse than one that did not move.
    setOn(wanted)
    try {
      setOn((await api.updateMyNotificationSettings({ on: [...wanted] })).on)
    } catch (failure) {
      setOn(on)
      setError(isApiError(failure) ? failure.message : 'Could not save that. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <FormError error={error} />

      {notificationSections.map((section) => (
        <table class="table" key={section.about}>
          <thead>
            <tr>
              <th scope="col">{section.heading}</th>
              <th scope="col">Notify me</th>
            </tr>
          </thead>
          <tbody>
            {categoriesAbout(section.about).map((category) => (
              <tr key={category}>
                <th scope="row">{notificationCategoryInfo[category].label}</th>
                <td>
                  <input
                    type="checkbox"
                    disabled={busy}
                    aria-label={notificationCategoryInfo[category].label}
                    checked={on.includes(category)}
                    onChange={(changeEvent) => void set(category, changeEvent.currentTarget.checked)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}

      <p class="form-note">
        The second list is about the burns you are coming to — nobody hears about a burn they have not said
        they are attending.
      </p>
    </>
  )
}
