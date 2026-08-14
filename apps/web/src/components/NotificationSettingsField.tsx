import type { DigestChoice, NotificationCategory, NotificationSettings } from '@sage-burner/shared'

import {
  categoriesAbout,
  digestChoiceInfo,
  digestChoices,
  isDigestChoice,
  notificationCategoryInfo,
  notificationSections,
} from '@sage-burner/shared'
import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { usePushNudge } from '../push-nudge.tsx'
import { isAdmin, useViewer } from '../viewer.tsx'
import { ErrorText } from './ErrorText.tsx'
import { FormError, useFormError } from './FormError.tsx'
import { Table } from './Table.tsx'

export type NotificationSettingsApi = Pick<
  ApiClient,
  'getMyNotificationSettings' | 'updateMyNotificationSettings'
>

type Channel = 'on' | 'email'

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
  const { askAbout } = usePushNudge()

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

  const save = async (wanted: NotificationSettings) => {
    setBusy(true)
    setError(undefined)
    setSettings(wanted)
    try {
      setSettings(
        await api.updateMyNotificationSettings({
          on: [...wanted.on],
          email: [...wanted.email],
          digest: wanted.digest,
        }),
      )
    } catch (failure) {
      setSettings(settings)
      setError(isApiError(failure) ? failure.message : 'Could not save that. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const set = async (channel: Channel, category: NotificationCategory, notify: boolean) => {
    const held = settings[channel]

    if (channel === 'on' && notify) askAbout()

    await save({
      ...settings,
      [channel]: notify ? [...held, category] : held.filter((one) => one !== category),
    })
  }

  const setDigest = async (digest: DigestChoice) => await save({ ...settings, digest })

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

      {sendsEmail && (
        <>
          <label class="field digest-choice">
            <span>A summary by email when you have stayed away</span>
            <select
              disabled={busy}
              value={settings.digest}
              onChange={(changeEvent) => {
                const chosen = changeEvent.currentTarget.value
                if (isDigestChoice(chosen)) void setDigest(chosen)
              }}
            >
              {digestChoices.map((choice) => (
                <option key={choice} value={choice}>
                  {digestChoiceInfo[choice].label}
                </option>
              ))}
            </select>
          </label>

          <p class="form-note">
            Only what you have not seen, and only when you have not been here — so it never arrives on a day
            you have already read it all.
          </p>
        </>
      )}

      <p class="form-note">
        What else is going on means the burns you are coming to — nobody hears about a burn they have not said
        they are attending.
        {sendsEmail && ' The Email column is off for every kind until you tick it.'}
      </p>
    </>
  )
}
