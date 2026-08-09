import type { OAuthProvider, OAuthSettings } from '@sage-burner/shared'

import { MAX_OAUTH_CLIENT_ID, MAX_OAUTH_CLIENT_SECRET, oauthProviderInfo } from '@sage-burner/shared'
import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { ErrorText } from './ErrorText.tsx'
import { PendingButton } from './PendingButton.tsx'

export type OauthApi = Pick<ApiClient, 'getOauthSettings' | 'updateOauthSettings' | 'removeOauthSettings'>

/** What the developer console calls itself, so an admin knows where to go. */
const consoles = {
  discord: {
    where: 'discord.com/developers/applications',
    cost: 'An application and a redirect URI. No review.',
  },
  facebook: {
    where: 'developers.facebook.com',
    cost: 'An app, a privacy-policy URL, and app review for public_profile before anybody outside your own account can use it.',
  },
} as const satisfies Record<OAuthProvider, { where: string; cost: string }>

/**
 * Setting one provider up (#393).
 *
 * `MailField`'s shape in every respect, including the one that matters: the secret is never
 * read back, so the box is empty with a placeholder saying one is stored, and a save that
 * leaves it empty keeps what is there. Typing nothing into a blank box is not clearing a
 * secret, and treating it as such would wipe one on every unrelated edit.
 *
 * The redirect URI is shown rather than asked for, because the backend builds it and it has to
 * match the provider exactly — an admin pasting a different one into the console is the
 * failure this prevents.
 */
export const OauthField = ({ api, provider }: { api: OauthApi; provider: OAuthProvider }) => {
  const [stored, setStored] = useState<OAuthSettings | null | undefined>(undefined)
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const info = oauthProviderInfo[provider]

  useEffect(() => {
    const controller = new AbortController()

    api
      .getOauthSettings(provider, controller.signal)
      .then(({ settings }) => {
        if (controller.signal.aborted) return
        setStored(settings)
        setClientId(settings?.client_id ?? '')
      })
      .catch(() => {
        if (!controller.signal.aborted) setStored(null)
      })

    return () => controller.abort()
  }, [api, provider])

  const run = async (work: () => Promise<{ settings: OAuthSettings | null }>) => {
    setError(undefined)
    setBusy(true)
    try {
      const { settings } = await work()
      setStored(settings)
      setClientId(settings?.client_id ?? '')
      setSecret('')
    } catch {
      setError('Could not save that. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2>
        <span aria-hidden="true">{info.icon}</span> Signing in with {info.label}
      </h2>

      <p class="form-note">
        From {consoles[provider].where}. {consoles[provider].cost} Until this is filled in, the button does
        not appear anywhere.
      </p>

      <p class="form-note">
        The redirect URI to register there is <code>/api/auth/oauth/{provider}/callback</code> on this
        installation's own address — the app builds it, and it has to match exactly.
      </p>

      {stored === undefined ? (
        <p class="form-note">Loading…</p>
      ) : (
        <form
          class="form"
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault()
            void run(
              async () =>
                await api.updateOauthSettings(provider, {
                  client_id: clientId.trim(),
                  // Omitted rather than sent empty: empty is a secret being cleared, and typing
                  // nothing into a box that was already blank is not that.
                  ...(secret === '' ? {} : { client_secret: secret }),
                }),
            )
          }}
        >
          <label class="field">
            <span>Client ID</span>
            <input
              type="text"
              maxLength={MAX_OAUTH_CLIENT_ID}
              aria-label={`${info.label} client ID`}
              disabled={busy}
              value={clientId}
              onInput={(inputEvent) => setClientId(inputEvent.currentTarget.value)}
            />
          </label>

          <label class="field">
            <span>Client secret</span>
            <input
              type="password"
              autocomplete="off"
              maxLength={MAX_OAUTH_CLIENT_SECRET}
              aria-label={`${info.label} client secret`}
              placeholder={stored?.has_secret === true ? 'Stored — leave blank to keep it' : ''}
              disabled={busy}
              value={secret}
              onInput={(inputEvent) => setSecret(inputEvent.currentTarget.value)}
            />
          </label>

          <p class="row">
            <PendingButton busy={busy} label="Save" busyLabel="Saving…" type="submit" />

            {stored !== null && (
              <button
                type="button"
                class="link-button"
                disabled={busy}
                onClick={() => void run(async () => await api.removeOauthSettings(provider))}
              >
                Remove
              </button>
            )}
          </p>

          <ErrorText message={error} />
        </form>
      )}
    </section>
  )
}
