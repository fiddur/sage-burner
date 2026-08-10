import { iconSrc } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { ICON_ACCEPT, preparedIcon } from '../icon.ts'
import { useInstallationIcon, useSetInstallationIcon } from '../installation.tsx'
import { ErrorText } from './ErrorText.tsx'

export type IconApi = Pick<ApiClient, 'removeInstallationIcon' | 'setInstallationIcon'>

export const messageForFailure = (failure: unknown): string => {
  if (!isApiError(failure)) return 'Could not read that image. A PNG or an SVG works best.'
  if (failure.status === 415) return 'That is not an image we can use. A PNG or an SVG works best.'
  if (failure.status === 413) return 'That image is too large to send.'
  if (failure.status === 401) return 'You have been signed out. Sign in again and have another go.'
  if (failure.status === 403) return 'Only an admin can change the icon.'
  if (failure.code === 'network') return failure.message

  return 'Could not save that icon. Please try again.'
}

export const IconField = ({ api }: { api: IconApi }) => {
  const stored = useInstallationIcon()
  const setStored = useSetInstallationIcon()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const choose = async (file: File) => {
    setBusy(true)
    setError(undefined)
    try {
      const { icon } = await api.setInstallationIcon(await preparedIcon(file))
      setStored(icon)
    } catch (failure) {
      setError(messageForFailure(failure))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await api.removeInstallationIcon()
      setStored(null)
    } catch (failure) {
      setError(messageForFailure(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="field">
      <span>The icon on a home screen</span>

      <p class="row">
        <img
          class="app-icon"
          src={iconSrc(stored)}
          alt="This installation's app icon"
          width={64}
          height={64}
        />

        <img
          class="app-icon app-icon-masked"
          src={iconSrc(stored)}
          alt="The same icon as a home screen will cut it"
          width={64}
          height={64}
        />

        <label class="link-button">
          Choose an image
          <input
            type="file"
            class="visually-hidden"
            accept={ICON_ACCEPT}
            aria-label="The icon on a home screen"
            disabled={busy}
            onChange={(changeEvent) => {
              const file = changeEvent.currentTarget.files?.[0]
              changeEvent.currentTarget.value = ''
              if (file !== undefined) void choose(file)
            }}
          />
        </label>

        <button type="button" class="link-button" disabled={busy} onClick={() => void remove()}>
          Back to the flame
        </button>
      </p>

      <ErrorText message={error} />

      <p class="form-note">
        An SVG is kept as it is; anything else is cut to a square and sized down to 512 by 512 in your
        browser. Fill the square right out to the edges and keep anything that matters within the round
        preview — a home screen crops to that shape, and a picture with see-through edges will float rather
        than sit on its own background. An iPhone cannot draw an SVG on a home screen, so upload a PNG if you
        want yours on the tile there: an SVG leaves the tile showing the app&rsquo;s own flame. Somebody who
        has already installed the app sees the new one when their browser next reads the manifest.
      </p>
    </div>
  )
}
