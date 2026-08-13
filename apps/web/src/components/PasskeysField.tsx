import { MAX_PASSKEY_LABEL } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { Ceremony, PasskeyApi } from '../passkey.ts'

import { isApiError } from '../api/client.ts'
import { useLoad } from '../load.ts'
import { addPasskey, messageForCeremony, passkeysWork } from '../passkey.ts'
import { Destroy } from './Destroy.tsx'
import { ErrorText } from './ErrorText.tsx'
import { FormError, useFormError } from './FormError.tsx'
import { PendingButton } from './PendingButton.tsx'

export type PasskeysApi = PasskeyApi & Pick<ApiClient, 'getMyPasskeys' | 'removePasskey'>

export const messageForRemoval = (failure: unknown): string => {
  if (isApiError(failure) && failure.status === 409) {
    return 'That is the only way you have left to sign in. Set a password first — ask someone with admin — and then it can go.'
  }

  return isApiError(failure) ? failure.message : 'Could not remove that passkey. Please try again.'
}

const added = (iso: string) => new Date(iso).toLocaleDateString()

export const PasskeysField = ({
  api,
  ceremony,
  supported = passkeysWork(),
}: {
  api: PasskeysApi
  ceremony?: Ceremony
  supported?: boolean
}) => {
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useFormError()

  const { loaded, reload } = useLoad(async (signal) => (await api.getMyPasskeys(signal)).passkeys, {
    enabled: supported,
    fallback: 'Could not load your passkeys. Please reload the page.',
  })
  const passkeys = loaded.status === 'ready' ? loaded.data : undefined

  const add = async () => {
    setError(undefined)
    setBusy(true)
    try {
      await addPasskey(api, label.trim(), ceremony)
      await reload()
      setLabel('')
    } catch (failure) {
      setError(messageForCeremony(failure, 'Could not register that passkey. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setError(undefined)
    setBusy(true)
    try {
      await api.removePasskey(id)
      await reload()
    } catch (failure) {
      setError(messageForRemoval(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2>Passkeys</h2>

      {!supported ? (
        <p class="form-note">
          This browser cannot use passkeys, or the site is not on HTTPS. Passkeys need both.
        </p>
      ) : (
        <>
          <p class="form-note">
            A passkey signs you in with whatever unlocks this device — a fingerprint, a face, a PIN — instead
            of a password. It stays on the device that made it, so register one on each you use. Your password
            keeps working either way.
          </p>

          {loaded.status === 'loading' && <p class="form-note">Loading…</p>}

          {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

          {passkeys?.length === 0 && <p class="form-note">You have no passkeys yet.</p>}

          {passkeys !== undefined && passkeys.length > 0 && (
            <ul class="passkey-list">
              {passkeys.map((key) => (
                <li key={key.id}>
                  <span>{key.label}</span>
                  <span class="form-note">
                    Added {added(key.created_at)}
                    {key.last_used_at === null ? ', never used' : `, last used ${added(key.last_used_at)}`}
                  </span>
                  <Destroy
                    what={key.label}
                    because="This device stops being a way in."
                    trigger="Remove"
                    triggerLabel={`Remove ${key.label}`}
                    busy={busy}
                    onDestroy={() => void remove(key.id)}
                  />
                </li>
              ))}
            </ul>
          )}

          <FormError error={error} />

          <form
            class="form"
            onSubmit={(submitEvent) => {
              submitEvent.preventDefault()
              void add()
            }}
          >
            <label class="field">
              <span>Name this device</span>
              <input
                type="text"
                name="passkey_label"
                maxLength={MAX_PASSKEY_LABEL}
                placeholder="Phone"
                required
                value={label}
                onInput={(inputEvent) => setLabel(inputEvent.currentTarget.value)}
              />
            </label>

            <PendingButton
              busy={busy}
              label="Add a passkey"
              busyLabel="One moment…"
              type="submit"
              disabled={label.trim() === ''}
            />
          </form>
        </>
      )}
    </section>
  )
}
