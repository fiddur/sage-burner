import type { NotificationCategory, NotificationSettings } from '@sage-burner/shared'

import { categoriesAbout, notificationCategoryInfo, notificationSections } from '@sage-burner/shared'
import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { FormError, useFormError } from './FormError.tsx'

export type NotificationSettingsApi = Pick<
  ApiClient,
  'getMyNotificationSettings' | 'updateMyNotificationSettings'
>

/** The two lists on the wire, which are also the two columns of each table. */
type Channel = keyof NotificationSettings

/**
 * Which happenings a member wants to hear about, and where.
 *
 * Ticked means notify. **The defaults are not all the same**, which is why the wire
 * carries what is on rather than what is off: what happens to you is on unless you
 * refuse it, and what happens around you is off unless you ask (#259). The server
 * applies them, so this only ever renders an answer it was given.
 *
 * A column per channel — *Here*, which is the bell and the push, and *Email* where
 * the installation has a mail server (#30). Email is off everywhere until it is asked
 * for, so it needs no defaults; the two are independent, so somebody may take the
 * burn-wide ones in their inbox and off their phone.
 *
 * Two sections, from `notificationSections`. The split is a property of the category
 * and lives beside its label, so adding one cannot land it in the wrong half here.
 *
 * Saved on each tick rather than behind a button: there is nothing to review and no
 * way to be half-done, and a settings table with a Save nobody presses is a table
 * that quietly does not apply.
 */
export const NotificationSettingsField = ({
  api,
  sendsEmail = false,
}: {
  api: NotificationSettingsApi
  /**
   * Whether this installation has a mail server (#30). No column at all when it has
   * none: a switch that cannot do anything is worse than an absent one, because it
   * reads as a promise.
   */
  sendsEmail?: boolean
}) => {
  const [settings, setSettings] = useState<NotificationSettings | undefined>(undefined)
  const [unavailable, setUnavailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useFormError()

  useEffect(() => {
    const controller = new AbortController()

    api
      .getMyNotificationSettings(controller.signal)
      .then((answered) => {
        if (!controller.signal.aborted) setSettings(answered)
      })
      .catch(() => {
        if (!controller.signal.aborted) setUnavailable(true)
      })

    return () => controller.abort()
  }, [api])

  /**
   * No table at all when the read failed, rather than one drawn from a guess.
   *
   * Every save here replaces the whole set, so an invented state is not a display
   * bug — it is committed. An empty table is the worst of them: the first tick after
   * a failed read would send `{ on: [that one] }` and switch off the six categories
   * this person never refused, losing payment and waiting-list notices silently.
   * Drawing the defaults instead would be wrong for anybody who *had* saved
   * settings. There is no state worth inventing, so there is none.
   */
  if (unavailable) {
    return (
      <p class="form-error" role="alert">
        Could not load your notification settings. Please reload the page.
      </p>
    )
  }

  if (settings === undefined) return <p class="form-note">Loading…</p>

  const set = async (channel: Channel, category: NotificationCategory, notify: boolean) => {
    const held = settings[channel]
    const wanted = {
      ...settings,
      [channel]: notify ? [...held, category] : held.filter((one) => one !== category),
    }

    setBusy(true)
    setError(undefined)
    // Moved before the request, so a tick is immediate; put back on failure, since a
    // box showing a setting that was refused is worse than one that did not move.
    setSettings(wanted)
    try {
      setSettings(await api.updateMyNotificationSettings({ on: [...wanted.on], email: [...wanted.email] }))
    } catch (failure) {
      setSettings(settings)
      setError(isApiError(failure) ? failure.message : 'Could not save that. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const channels: readonly { channel: Channel; heading: string }[] = [
    { channel: 'on', heading: 'Here' },
    ...(sendsEmail ? [{ channel: 'email' as const, heading: 'Email' }] : []),
  ]

  return (
    <>
      <FormError error={error} />

      {notificationSections.map((section) => (
        <table class="table notification-settings" key={section.about}>
          <thead>
            <tr>
              <th scope="col">{section.heading}</th>
              {channels.map(({ channel, heading }) => (
                <th scope="col" key={channel}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categoriesAbout(section.about).map((category) => (
              <tr key={category}>
                <th scope="row">{notificationCategoryInfo[category].label}</th>
                {channels.map(({ channel, heading }) => (
                  <td key={channel}>
                    <input
                      type="checkbox"
                      disabled={busy}
                      // The label names both, because a row now has two boxes and
                      // "Put on or taken off a meal" twice is two controls a screen
                      // reader cannot tell apart.
                      aria-label={`${notificationCategoryInfo[category].label} — ${heading}`}
                      checked={settings[channel].includes(category)}
                      onChange={(changeEvent) =>
                        void set(channel, category, changeEvent.currentTarget.checked)
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ))}

      <p class="form-note">
        The second list is about the burns you are coming to — nobody hears about a burn they have not said
        they are attending.
        {sendsEmail && ' Email is off everywhere until you ask for it.'}
      </p>
    </>
  )
}
