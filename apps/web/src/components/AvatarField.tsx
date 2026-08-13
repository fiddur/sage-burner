import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { AVATAR_TYPE, resizedAvatar } from '../avatar.ts'
import { useSetViewer, useViewer } from '../viewer.tsx'
import { Avatar } from './Avatar.tsx'
import { Destroy } from './Destroy.tsx'
import { ErrorText } from './ErrorText.tsx'

export const messageForFailure = (failure: unknown): string => {
  if (!isApiError(failure)) return 'Could not read that picture. A JPEG, PNG or WebP works best.'
  if (failure.status === 415) return 'That is not a picture we can use. A JPEG, PNG or WebP works best.'
  if (failure.status === 401) return 'You have been signed out. Sign in again and have another go.'
  if (failure.status === 413) return 'That picture is too large to send.'
  if (failure.code === 'network') return failure.message

  return 'Could not save that picture. Please try again.'
}

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
              changeEvent.currentTarget.value = ''
              if (file !== undefined) void choose(file)
            }}
          />
        </label>

        {account.avatar !== null && (
          <Destroy
            what="your picture"
            because="Your initials go back in its place."
            trigger="Back to initials"
            busy={busy}
            onDestroy={() => void remove()}
          />
        )}
      </p>

      <ErrorText message={error} />

      <p class="form-note">
        Cut to a square and sized down in your browser before it is sent, as {AVATAR_TYPE}.
      </p>
    </div>
  )
}
