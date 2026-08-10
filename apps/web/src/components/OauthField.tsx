import type { OAuthProvider, OAuthSettings } from '@sage-burner/shared'

import {
  apiRoutes,
  MAX_OAUTH_CLIENT_ID,
  MAX_OAUTH_CLIENT_SECRET,
  oauthProviderInfo,
} from '@sage-burner/shared'
import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { useSetProviderConfigured } from '../installation.tsx'
import { ErrorText } from './ErrorText.tsx'
import { PendingButton } from './PendingButton.tsx'

export type OauthApi = Pick<ApiClient, 'getOauthSettings' | 'updateOauthSettings' | 'removeOauthSettings'>

const consoles = {
  discord: {
    where: 'discord.com/developers/applications',
    cost: 'An application and a redirect URI. No review.',
    consent: '“your username, avatar and banner” — the least Discord lets any app ask for',
    keeps:
      'an identifier, their Discord name as a way other members can reach them, and — if they have no picture here — a copy of theirs',
  },
  facebook: {
    where: 'developers.facebook.com',
    cost: 'An app, the URLs listed below, and app review for public_profile before anybody outside your own account can use it.',
    consent: 'your public profile — the eight fields public_profile covers, of which this app reads two',
    keeps: 'an identifier and, if they have no picture here, a copy of theirs',
  },
} as const satisfies Record<OAuthProvider, { where: string; cost: string; consent: string; keeps: string }>

export const OauthField = ({ api, provider }: { api: OauthApi; provider: OAuthProvider }) => {
  const [stored, setStored] = useState<OAuthSettings | null | undefined>(undefined)
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [askProfileLink, setAskProfileLink] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const setProviderConfigured = useSetProviderConfigured()

  const info = oauthProviderInfo[provider]

  useEffect(() => {
    const controller = new AbortController()

    api
      .getOauthSettings(provider, controller.signal)
      .then(({ settings }) => {
        if (controller.signal.aborted) return
        setStored(settings)
        setClientId(settings?.client_id ?? '')
        setAskProfileLink(settings?.ask_profile_link ?? false)
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
      setAskProfileLink(settings?.ask_profile_link ?? false)
      setSecret('')
      setProviderConfigured(provider, settings !== null && settings.client_id !== '' && settings.has_secret)
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
        The redirect URI to register there is <code>{apiRoutes.finishOauth.path(provider)}</code> on this
        installation's own address — the app builds it, and it has to match exactly.
      </p>

      <p class="form-note">
        Your members will be asked to allow {consoles[provider].consent}. What this app keeps of it is{' '}
        {consoles[provider].keeps} — <a href="/privacy">/privacy</a> says so, and it is the page they can
        check.
      </p>

      {provider === 'facebook' && (
        <>
          <p class="form-note">
            Basic Settings asks for three more URLs, all on this installation's own address and all readable
            by a reviewer who is not signed in:
          </p>

          <ul class="form-note">
            <li>
              Privacy Policy — <a href="/privacy">/privacy</a>
            </li>
            <li>
              Terms of Service — <a href="/terms">/terms</a>
            </li>
            <li>
              Data Deletion Instructions — <a href="/privacy">/privacy</a> again, which says how to take a
              linked provider off an account
            </li>
          </ul>
        </>
      )}

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
                  ask_profile_link: askProfileLink,
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

          {stored?.has_secret === true && (
            <p class="form-note">
              A secret pasted from the console often brings a line break with it. It is trimmed on the way in
              — but one stored before that fix still has it, and every sign-in will keep failing until you
              paste it again here.
            </p>
          )}

          {provider === 'facebook' && (
            <>
              <label class="row">
                <input
                  type="checkbox"
                  name="ask_profile_link"
                  checked={askProfileLink}
                  disabled={busy}
                  onChange={(changeEvent) => setAskProfileLink(changeEvent.currentTarget.checked)}
                />
                <span>This app has been approved for user_link</span>
              </label>

              <p class="form-note">
                Only tick that once <code>user_link</code> shows as approved in the console. It puts
                somebody's Facebook page on their profile here when they link a sign-in, and asking for a
                permission the app does not have would send people to a consent screen that refuses them.
                Untick it and the next sign-in asks for nothing extra.
              </p>
            </>
          )}

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
