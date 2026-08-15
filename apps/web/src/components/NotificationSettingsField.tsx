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
import { Icon } from './Icon.tsx'
import { Table } from './Table.tsx'

export type NotificationSettingsApi = Pick<
  ApiClient,
  'getMyNotificationSettings' | 'updateMyNotificationSettings'
>

type Channel = 'on' | 'email'

type About = (typeof notificationSections)[number]['about']

const Master = ({
  label,
  every,
  chosen,
  busy,
  onSet,
}: {
  label: string
  every: readonly NotificationCategory[]
  chosen: readonly NotificationCategory[]
  busy: boolean
  onSet: (wanted: boolean) => void
}) => {
  const many = every.filter((category) => chosen.includes(category)).length

  return (
    <label class="notification-master">
      <input
        type="checkbox"
        disabled={busy}
        aria-label={label}
        checked={many === every.length}
        indeterminate={many > 0 && many < every.length}
        onChange={(changeEvent) => onSet(changeEvent.currentTarget.checked)}
      />
      <span aria-hidden="true">{label.split(' — ').at(-1)}</span>
    </label>
  )
}

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
  const [opened, setOpened] = useState<readonly About[]>([])
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

  const setEvery = async (channel: Channel, every: readonly NotificationCategory[], notify: boolean) => {
    const held = settings[channel].filter((one) => !every.includes(one))

    if (channel === 'on' && notify) askAbout()

    await save({ ...settings, [channel]: notify ? [...held, ...every] : held })
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

      {sections.map((section) => {
        const every = categoriesAbout(section.about)
        const alone = every.length === 1
        const open = opened.includes(section.about)

        return (
          <section class="notification-section" key={section.about}>
            <div class="notification-section-head">
              {alone ? (
                <span class="notification-section-name">{section.heading}</span>
              ) : (
                <button
                  type="button"
                  class="link-button notification-section-name"
                  aria-expanded={open}
                  onClick={() =>
                    setOpened((sofar) =>
                      open ? sofar.filter((one) => one !== section.about) : [...sofar, section.about],
                    )
                  }
                >
                  {section.heading}
                  <Icon name={open ? 'chevron-down' : 'chevron-right'} />
                </button>
              )}

              <div class="notification-switches">
                {channels.map(({ channel, heading }) => (
                  <Master
                    key={channel}
                    label={`${section.heading} — ${heading}`}
                    every={every}
                    chosen={settings[channel]}
                    busy={busy}
                    onSet={(wanted) => void setEvery(channel, every, wanted)}
                  />
                ))}
              </div>
            </div>

            {open && (
              <Table class="notification-settings">
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
                  {every.map((category) => (
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
            )}
          </section>
        )
      })}

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
            The feed since you were last here, whatever the switches above say — and only when you have not
            been here, so it never arrives on a day you have already read it all.
          </p>
        </>
      )}

      <p class="form-note">
        What others are doing means the burns you are coming to — nobody hears about a burn they have not said
        they are attending.
        {sendsEmail && ' The Email column is off for every kind until you tick it.'}
      </p>
    </>
  )
}
