import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { AVATAR_TYPE, resizedAvatar } from '../avatar.ts'
import { useSetViewer, useViewer } from '../viewer.tsx'
import { Avatar } from './Avatar.tsx'

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
    } catch {
      setError('Could not use that picture. A JPEG, PNG or WebP works best.')
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
    } catch {
      setError('Could not remove that picture.')
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

      {error !== undefined && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}

      <p class="form-note">
        Cut to a square and sized down in your browser before it is sent, as {AVATAR_TYPE}.
      </p>
    </div>
  )
}
