import type { OAuthProvider } from '@sage-burner/shared'

import { apiRoutes, oauthProviderInfo, oauthProviders } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { useSocialLogins } from '../installation.tsx'
import { useLoad } from '../load.ts'
import { quoting, useOauthOutcome } from '../outcome.ts'
import { ErrorText } from './ErrorText.tsx'
import { FormError, useFormError } from './FormError.tsx'

export type WaysInApi = Pick<ApiClient, 'getMyIdentities' | 'removeMyIdentity'>

export const messageForRemoval = (failure: unknown): string => {
  if (isApiError(failure) && failure.status === 409) {
    return 'That is the only way you have left to sign in. Set a password or add a passkey first, and then it can go.'
  }

  return isApiError(failure) ? failure.message : 'Could not take that off. Please try again.'
}

export const outcomeMessage = (outcome: string | null, ref: string | null = null): string | undefined => {
  if (outcome === 'linked') return 'That is linked now — you can sign in with it next time.'
  if (outcome === 'reached') {
    return 'That is linked now — you can sign in with it next time, and your name there has been added to how people can reach you. Take it off that list if you would rather it was not.'
  }
  if (outcome === 'taken') return 'That account is already linked to somebody here.'
  if (outcome === 'misconfigured') {
    return `That provider refused the connection, so it is not set up correctly here. Nothing has changed. Please tell an organiser.${quoting(ref)}`
  }
  if (outcome === 'unreachable') {
    return `That provider could not be reached, so nothing has changed. Try again in a moment; if it keeps happening, tell an organiser.${quoting(ref)}`
  }
  if (outcome === 'refused') return 'That did not work. Nothing has changed.'

  return undefined
}

const added = (iso: string) => new Date(iso).toLocaleDateString()

export const WaysInField = ({ api }: { api: WaysInApi }) => {
  const configured = useSocialLogins()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useFormError()
  const { outcome: came, ref } = useOauthOutcome()
  const outcome = outcomeMessage(came, ref)

  const { loaded, reload } = useLoad(async (signal) => (await api.getMyIdentities(signal)).identities, {
    fallback: 'Could not load your ways in. Please reload the page.',
  })
  const identities = loaded.status === 'ready' ? loaded.data : undefined

  const offered = oauthProviders.filter((provider) => configured.includes(provider))
  if (offered.length === 0) return null

  const held = (provider: OAuthProvider) => identities?.some((row) => row.provider === provider) === true

  const remove = async (provider: OAuthProvider) => {
    setError(undefined)
    setBusy(true)
    try {
      await api.removeMyIdentity(provider)
      await reload()
    } catch (failure) {
      setError(messageForRemoval(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2>Other ways to sign in</h2>

      <p class="form-note">
        As well as your password and any passkeys — not instead of them. You cannot take away the last way you
        have of getting in.
      </p>

      {outcome !== undefined && <p class="form-note">{outcome}</p>}

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}

      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      {identities !== undefined && (
        <ul class="ways-in">
          {offered.map((provider) => (
            <li key={provider}>
              <span aria-hidden="true">{oauthProviderInfo[provider].icon}</span>
              <span class="way-what">
                <span class="way-name">{oauthProviderInfo[provider].label}</span>{' '}
                {held(provider) ? (
                  <span class="form-note">
                    linked {added(identities.find((row) => row.provider === provider)?.created_at ?? '')}
                  </span>
                ) : (
                  <span class="form-note">not linked</span>
                )}
              </span>

              {held(provider) ? (
                <button
                  type="button"
                  class="link-button"
                  disabled={busy}
                  aria-label={`Take ${oauthProviderInfo[provider].label} off your account`}
                  onClick={() => void remove(provider)}
                >
                  Take it off
                </button>
              ) : (
                <a class="link-button" href={apiRoutes.startOauthLink.path(provider)}>
                  Link it
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      {offered.includes('facebook') && (
        <p class="form-note">
          If you want people to reach you on Facebook, add your Facebook name under How people can reach you —
          that puts Messenger in your list, and the page it links to works for anybody. Linking a sign-in here
          may fill your profile page in too, depending on what this installation's app was set up to ask for,
          but that link only opens for people already logged in to Facebook.
        </p>
      )}

      <FormError error={error} />
    </section>
  )
}
