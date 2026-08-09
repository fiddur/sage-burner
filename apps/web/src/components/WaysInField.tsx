import type { Identity, OAuthProvider } from '@sage-burner/shared'

import { apiRoutes, oauthProviderInfo, oauthProviders, OAUTH_OUTCOME_PARAM } from '@sage-burner/shared'
import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { useSocialLogins } from '../installation.tsx'
import { FormError, useFormError } from './FormError.tsx'

export type WaysInApi = Pick<ApiClient, 'getMyIdentities' | 'removeMyIdentity'>

/**
 * Why a way in could not be taken off.
 *
 * The 409 is the only interesting one and it is worth its own sentence: the server refuses to
 * leave an account with no way to sign in, and "that did not work" would send somebody trying
 * again forever. `PasskeysField.messageForRemoval` is the same shape for the same reason.
 */
export const messageForRemoval = (failure: unknown): string => {
  if (isApiError(failure) && failure.status === 409) {
    return 'That is the only way you have left to sign in. Set a password or add a passkey first, and then it can go.'
  }

  return isApiError(failure) ? failure.message : 'Could not take that off. Please try again.'
}

/** What the page says about a round trip that has just come back. */
export const outcomeMessage = (outcome: string | null): string | undefined => {
  if (outcome === 'linked') return 'That is linked now — you can sign in with it next time.'
  if (outcome === 'taken') return 'That account is already linked to somebody here.'
  if (outcome === 'refused') return 'That did not work. Nothing has changed.'

  return undefined
}

const added = (iso: string) => new Date(iso).toLocaleDateString()

/**
 * The ways in on this account, and adding one (#393).
 *
 * **A way in is an extra way in, never the only one imposed** (#9), which is why this sits
 * beside the password and the passkeys rather than replacing either — and why the server
 * refuses to remove the last of them.
 *
 * Only providers the installation has set up appear, read from the same public
 * `social_logins` the login page uses: a button that cannot work reads as a promise.
 *
 * Linking is a plain link rather than a fetch, because the whole point is to leave the page —
 * `fetch` cannot follow a redirect to somebody else's consent screen.
 */
export const WaysInField = ({ api }: { api: WaysInApi }) => {
  const configured = useSocialLogins()
  const [identities, setIdentities] = useState<Identity[] | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useFormError()

  useEffect(() => {
    const controller = new AbortController()

    api
      .getMyIdentities(controller.signal)
      .then(({ identities: mine }) => {
        if (!controller.signal.aborted) setIdentities(mine)
      })
      .catch(() => {
        if (!controller.signal.aborted) setIdentities([])
      })

    return () => controller.abort()
  }, [api])

  const offered = oauthProviders.filter((provider) => configured.includes(provider))
  if (offered.length === 0) return null

  const held = (provider: OAuthProvider) => identities?.some((row) => row.provider === provider) === true

  const remove = async (provider: OAuthProvider) => {
    setError(undefined)
    setBusy(true)
    try {
      await api.removeMyIdentity(provider)
      setIdentities((mine) => mine?.filter((row) => row.provider !== provider))
    } catch (failure) {
      setError(messageForRemoval(failure))
    } finally {
      setBusy(false)
    }
  }

  const outcome = outcomeMessage(new URLSearchParams(window.location.search).get(OAUTH_OUTCOME_PARAM))

  return (
    <section>
      <h2>Other ways to sign in</h2>

      <p class="form-note">
        As well as your password and any passkeys — not instead of them. You cannot take away the last way you
        have of getting in.
      </p>

      {outcome !== undefined && <p class="form-note">{outcome}</p>}

      {identities === undefined && <p class="form-note">Loading…</p>}

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
                // A link, not a fetch: the point is to leave for somebody else's consent
                // screen, which `fetch` cannot follow.
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
          Linking Facebook also puts your Facebook page on your profile for other members, and offers
          Messenger as a way to reach you — which you can reorder or take off under How people can reach you.
        </p>
      )}

      <FormError error={error} />
    </section>
  )
}
