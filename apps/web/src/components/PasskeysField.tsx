import type { Passkey } from '@sage-burner/shared'

import { MAX_PASSKEY_LABEL } from '@sage-burner/shared'
import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { Ceremony, PasskeyApi } from '../passkey.ts'

import { isApiError } from '../api/client.ts'
import { addPasskey, messageForCeremony, passkeysWork } from '../passkey.ts'
import { FormError, useFormError } from './FormError.tsx'

export type PasskeysApi = PasskeyApi & Pick<ApiClient, 'getMyPasskeys' | 'removePasskey'>

/**
 * Why a passkey could not be removed.
 *
 * The 409 is the only interesting one, and it is worth its own sentence: the
 * server refuses to leave an account with no password and no passkey, and the
 * generic "that did not work" would send somebody trying again forever.
 */
export const messageForRemoval = (failure: unknown): string => {
  if (isApiError(failure) && failure.status === 409) {
    return 'That is the only way you have left to sign in. Set a password first — ask someone with admin — and then it can go.'
  }

  return isApiError(failure) ? failure.message : 'Could not remove that passkey. Please try again.'
}

const added = (iso: string) => new Date(iso).toLocaleDateString()

/**
 * The passkeys on this account, and adding one from the device in front of you.
 *
 * Per device rather than per person, like notifications: a passkey lives in the
 * phone or laptop that made it, so somebody with both registers twice and names
 * them so the list means something later.
 *
 * `ceremony` and `supported` are injectable because `navigator.credentials` is
 * absent under happy-dom — a test driving the real one would exercise the
 * unsupported branch and nothing else.
 */
export const PasskeysField = ({
  api,
  ceremony,
  supported = passkeysWork(),
}: {
  api: PasskeysApi
  ceremony?: Ceremony
  supported?: boolean
}) => {
  const [passkeys, setPasskeys] = useState<Passkey[] | undefined>(undefined)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useFormError()

  useEffect(() => {
    const controller = new AbortController()

    api
      .getMyPasskeys(controller.signal)
      .then(({ passkeys: mine }) => {
        if (!controller.signal.aborted) setPasskeys(mine)
      })
      .catch(() => {
        if (!controller.signal.aborted) setPasskeys([])
      })

    return () => controller.abort()
  }, [api])

  const add = async () => {
    setError(undefined)
    setBusy(true)
    try {
      const { passkeys: mine } = await addPasskey(api, label.trim(), ceremony)
      setPasskeys(mine)
      setLabel('')
    } catch (failure) {
      // Undefined for a cancelled dialog: closing it is an ordinary thing to do,
      // and reporting it as an error would be the page telling somebody off for
      // changing their mind.
      setError(messageForCeremony(failure, 'Could not register that passkey. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setError(undefined)
    setBusy(true)
    try {
      const { passkeys: mine } = await api.removePasskey(id)
      setPasskeys(mine)
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

          {passkeys === undefined && <p class="form-note">Loading…</p>}

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
                  <button
                    type="button"
                    class="link-button"
                    disabled={busy}
                    aria-label={`Remove ${key.label}`}
                    onClick={() => void remove(key.id)}
                  >
                    Remove
                  </button>
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

            <button type="submit" disabled={busy || label.trim() === ''}>
              {busy ? 'One moment…' : 'Add a passkey'}
            </button>
          </form>
        </>
      )}
    </section>
  )
}
