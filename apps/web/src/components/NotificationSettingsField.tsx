import type { NotificationCategory, NotificationSettings } from '@sage-burner/shared'

import { categoriesAbout, notificationCategoryInfo, notificationSections } from '@sage-burner/shared'
import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { isAdmin, useViewer } from '../viewer.tsx'
import { ErrorText } from './ErrorText.tsx'
import { FormError, useFormError } from './FormError.tsx'
import { Table } from './Table.tsx'

export type NotificationSettingsApi = Pick<
  ApiClient,
  'getMyNotificationSettings' | 'updateMyNotificationSettings'
>

type Channel = keyof NotificationSettings

export const NotificationSettingsField = ({
  api,
  sendsEmail = false,
}: {
  api: NotificationSettingsApi
  sendsEmail?: boolean
}) => {
  const admin = isAdmin(useViewer())
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

  if (unavailable) {
    return <ErrorText message="Could not load your notification settings. Please reload the page." />
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

  const sections = notificationSections.filter((section) => section.about !== 'admin' || admin)

  return (
    <>
      <FormError error={error} />

      {sections.map((section) => (
        <Table class="notification-settings" key={section.about}>
          <caption>{section.heading}</caption>
          <thead>
            <tr>
              <th scope="col" />
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
        </Table>
      ))}

      <p class="form-note">
        What else is going on means the burns you are coming to — nobody hears about a burn they have not said
        they are attending.
        {sendsEmail && ' Email is off everywhere until you ask for it.'}
      </p>
    </>
  )
}
