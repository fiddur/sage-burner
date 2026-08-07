import { apiRoutes } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { ICON_ACCEPT, preparedIcon } from '../icon.ts'

export type IconApi = Pick<ApiClient, 'removeInstallationIcon' | 'setInstallationIcon'>

/**
 * Why the icon did not go up.
 *
 * Split out for the same reason `AvatarField`'s is: `preparedIcon` throws in
 * happy-dom before any request is made, so a component test cannot reach these
 * branches at all.
 */
export const messageForFailure = (failure: unknown): string => {
  if (!isApiError(failure)) return 'Could not read that image. A PNG or an SVG works best.'
  if (failure.status === 415) return 'That is not an image we can use. A PNG or an SVG works best.'
  if (failure.status === 413) return 'That image is too large to send.'
  if (failure.status === 401) return 'You have been signed out. Sign in again and have another go.'
  if (failure.status === 403) return 'Only an organiser can change the icon.'
  if (failure.code === 'network') return failure.message

  return 'Could not save that icon. Please try again.'
}

/**
 * Choosing the icon an installed copy of this app wears (#256).
 *
 * Editable rather than configured, for the reason the title beside it is: an
 * installation should be able to look like itself without an operator, a redeploy, or
 * a fork.
 *
 * **An SVG is stored exactly as chosen.** That is a decision rather than an oversight
 * — rasterising a logo is what makes it worth uploading pointless — and it means an
 * admin can upload a file that carries script. The route serves it sandboxed so it
 * cannot execute against this app, and only an admin can put one there.
 *
 * The preview is the live route with a version on it, so saving one shows the new
 * one rather than whatever the browser already had under that URL.
 */
export const IconField = ({ api }: { api: IconApi }) => {
  const [version, setVersion] = useState('current')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const choose = async (file: File) => {
    setBusy(true)
    setError(undefined)
    try {
      const { icon } = await api.setInstallationIcon(await preparedIcon(file))
      setVersion(icon)
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
      setVersion(`removed-${version}`)
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
          src={`${apiRoutes.getInstallationIcon.path()}?v=${version}`}
          alt="This installation's app icon"
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
              // Cleared, so the same file can be chosen again after a failure —
              // without this a retry of the identical image fires no change event.
              changeEvent.currentTarget.value = ''
              if (file !== undefined) void choose(file)
            }}
          />
        </label>

        <button type="button" class="link-button" disabled={busy} onClick={() => void remove()}>
          Back to the flame
        </button>
      </p>

      {error !== undefined && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}

      <p class="form-note">
        An SVG is kept as it is; anything else is cut to a square and sized down in your browser. Somebody who
        has already installed the app sees the new one when their browser next reads the manifest.
      </p>
    </div>
  )
}
