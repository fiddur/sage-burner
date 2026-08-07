import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { AVATAR_TYPE, resizedAvatar } from '../avatar.ts'
import { useSetViewer, useViewer } from '../viewer.tsx'
import { Avatar } from './Avatar.tsx'
import { ErrorText } from './ErrorText.tsx'

/**
 * Why the picture did not go up.
 *
 * The format advice is only right for a failure that is actually about the file, and
 * it is expensive to get wrong: it sends somebody with a perfectly good photo off to
 * re-export it, and the second attempt fails the same way.
 *
 * Anything that is not an `ApiError` never reached the network — `resizedAvatar`
 * throws when the browser cannot decode what was chosen, which is the one case the
 * format advice fits. `415` is the server saying the same thing about the bytes it
 * received.
 *
 * Exported to be tested: a component test cannot reach these branches, because
 * `resizedAvatar` throws in happy-dom before any request is made.
 */
export const messageForFailure = (failure: unknown): string => {
  if (!isApiError(failure)) return 'Could not read that picture. A JPEG, PNG or WebP works best.'
  if (failure.status === 415) return 'That is not a picture we can use. A JPEG, PNG or WebP works best.'
  if (failure.status === 401) return 'You have been signed out. Sign in again and have another go.'
  if (failure.status === 413) return 'That picture is too large to send.'
  // Its own message already says to check the connection, and that advice belongs
  // here and nowhere else — every other branch is answering a response that arrived.
  if (failure.code === 'network') return failure.message

  return 'Could not save that picture. Please try again.'
}

/**
 * Choosing a picture for the circle, or going back to initials.
 *
 * The picture is cut to a square and sized down **here**, before it is sent, which is
 * what lets the server store what it is given without an image library. A phone
 * camera's ten megabytes becomes tens of kilobytes, and the upload cap is then
 * generous rather than a limit anybody meets.
 *
 * The viewer is updated in place on success so the corner changes without a reload —
 * the version it now holds is what the circle's URL carries, so the new picture is a
 * new URL and the old one cannot be shown from a cache.
 */
export const AvatarField = ({ api }: { api: Pick<ApiClient, 'removeMyAvatar' | 'setMyAvatar'> }) => {
  const viewer = useViewer()
  const setViewer = useSetViewer()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const account = viewer.account
  if (account === undefined) return null

  const withAvatar = (avatar: string | null) => setViewer({ ...account, avatar })

  const choose = async (file: File) => {
    setBusy(true)
    setError(undefined)
    try {
      const { avatar } = await api.setMyAvatar(await resizedAvatar(file))
      withAvatar(avatar)
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
      await api.removeMyAvatar()
      withAvatar(null)
    } catch (failure) {
      setError(
        isApiError(failure) && failure.status === 401
          ? 'You have been signed out. Sign in again and have another go.'
          : 'Could not remove that picture. Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="field">
      <span>Your picture</span>

      <p class="row">
        <Avatar accountId={account.id} name={account.name} avatar={account.avatar} />

        <label class="link-button">
          {account.avatar === null ? 'Choose a picture' : 'Change it'}
          <input
            type="file"
            class="visually-hidden"
            accept="image/*"
            aria-label="Your picture"
            disabled={busy}
            onChange={(changeEvent) => {
              const file = changeEvent.currentTarget.files?.[0]
              // Cleared, so the same file can be chosen again after a failure —
              // without this a retry of the identical picture fires no change event.
              changeEvent.currentTarget.value = ''
              if (file !== undefined) void choose(file)
            }}
          />
        </label>

        {account.avatar !== null && (
          <button type="button" class="link-button" disabled={busy} onClick={() => void remove()}>
            Back to initials
          </button>
        )}
      </p>

      <ErrorText message={error} />

      <p class="form-note">
        Cut to a square and sized down in your browser before it is sent, as {AVATAR_TYPE}.
      </p>
    </div>
  )
}
