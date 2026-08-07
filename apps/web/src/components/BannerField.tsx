import { apiRoutes } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { BANNER_ACCEPT, preparedBanner } from '../banner.ts'
import { useInstallationBanner, useSetInstallationBanner } from '../installation.tsx'
import { ErrorText } from './ErrorText.tsx'

export type BannerApi = Pick<ApiClient, 'removeInstallationBanner' | 'setInstallationBanner'>

/**
 * Why the banner did not go up.
 *
 * Split out for the same reason `IconField`'s is: `preparedBanner` throws in happy-dom
 * before any request is made, so a component test cannot reach these branches at all.
 */
export const messageForFailure = (failure: unknown): string => {
  if (!isApiError(failure)) return 'Could not read that image. A wide photograph works best.'
  if (failure.status === 415) return 'That is not an image we can use. A wide photograph works best.'
  if (failure.status === 413) return 'That image is too large to send.'
  if (failure.status === 401) return 'You have been signed out. Sign in again and have another go.'
  if (failure.status === 403) return 'Only an admin can change the banner.'
  if (failure.code === 'network') return failure.message

  return 'Could not save that banner. Please try again.'
}

/**
 * The picture a link to this installation shows, and the homepage's own banner (#306).
 *
 * Shown at the shape it will be — the format is what decides whether a card is a big
 * picture or a thumbnail beside two lines of text, and that is not something to find
 * out from Facebook afterwards.
 *
 * The new banner goes into the installation context rather than only into local state:
 * it is drawn on the homepage, which is one client-side navigation away and fetches
 * nothing on the way there.
 */
export const BannerField = ({ api }: { api: BannerApi }) => {
  const banner = useInstallationBanner()
  const setBanner = useSetInstallationBanner()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const choose = async (file: File) => {
    setBusy(true)
    setError(undefined)
    try {
      const response = await api.setInstallationBanner(await preparedBanner(file))
      setBanner(response.banner)
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
      await api.removeInstallationBanner()
      setBanner(null)
    } catch (failure) {
      setError(messageForFailure(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="field">
      <span>The picture a shared link shows</span>

      {banner !== undefined && banner !== null && (
        <img
          class="banner-preview"
          src={`${apiRoutes.getInstallationBanner.path()}?v=${encodeURIComponent(banner)}`}
          alt="The banner as it is now"
        />
      )}

      <p class="row">
        <label class="link-button">
          {banner === null ? 'Choose an image' : 'Choose another image'}
          <input
            type="file"
            class="visually-hidden"
            accept={BANNER_ACCEPT}
            aria-label="The picture a shared link shows"
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

        {banner !== undefined && banner !== null && (
          <button type="button" class="link-button" disabled={busy} onClick={() => void remove()}>
            Remove it
          </button>
        )}
      </p>

      <ErrorText message={error} />

      <p class="form-note">
        1200 × 630 works best. Facebook shows a large card above about 600 × 315 and a small thumbnail below
        it, so a wide picture is the difference between the two. Anything narrower is cut to that shape from
        the middle in your browser — keep what matters away from the edges, since every app crops a little
        differently. With no banner, a shared link falls back to the app icon and the small card.
      </p>
    </div>
  )
}
