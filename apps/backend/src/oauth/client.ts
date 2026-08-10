import type { OAuthProvider } from '@sage-burner/shared'

import type { ProviderAsks, ProviderProfile } from './providers.ts'

import { AVATAR_TYPES, MAX_AVATAR_BYTES } from '../routes/avatars.ts'
import { providerShapes, stringField } from './providers.ts'

/**
 * The only module here that opens a socket (#393).
 *
 * `mail/smtp.ts` and `push/web-push.ts` are the same idea for their features: one module
 * that talks to the outside, injected at `createApp`, so every test in the suite runs
 * without leaving the machine and nothing else in the process has to be trusted not to.
 *
 * **Nothing here throws.** A provider that is down, slow or answering nonsense costs
 * somebody a sign-in attempt, not a stack trace — the rule email and push already follow.
 * The routes turn a failure into a refusal they can word.
 *
 * **It must not cost the reason as well** (#430). A bare `undefined` made a secret with a
 * stray space, a redirect URI registered slightly differently, a scope the app was never
 * approved for and a container with no outbound HTTPS into one indistinguishable refusal,
 * recorded nowhere — and the person who configured the provider is the person running the
 * installation, so a five-minute fix became an unfixable mystery. The failure carries which
 * leg, the status, and what the provider said; the route logs it and words the refusal the
 * same as before.
 */

const TIMEOUT_MS = 10_000

/** How much of a provider's answer is worth keeping for a log line. */
const MAX_SAID = 300

export interface IdentifyInput {
  provider: OAuthProvider
  clientId: string
  clientSecret: string
  redirectUri: string
  code: string
  /**
   * What was asked for at the authorize step, so the profile read asks for the same.
   *
   * The two have to agree: naming a field the token was never scoped for is the one case
   * `providerShapes` deliberately never puts a sign-in in.
   */
  asks: ProviderAsks
}

/**
 * Why a round trip could not be finished — for the log, never for the member (#430).
 *
 * `said` is the provider's own answer, which is the part that actually answers the
 * question: Facebook replies `{"error":{"message":"…"}}` and Discord `{"error":
 * "invalid_client"}`, and either names the misconfiguration outright.
 *
 * **What we sent is never in here.** The client secret, the authorization code and the
 * access token are all things this module *sends*; `said` is what came back, so none of them
 * can appear in it. `client.test.ts` asserts that rather than trusting it.
 */
export interface IdentifyFailure {
  /** Which leg gave up: exchanging the code, reading the profile, or never arriving. */
  at: 'token' | 'profile' | 'network'
  /** The HTTP status, where there was a response at all. */
  status?: number
  /** What the provider said, bounded to `MAX_SAID`. */
  said?: string
}

/**
 * One or the other, tagged rather than guessed at.
 *
 * A bare union of `ProviderProfile | IdentifyFailure` would be narrowed by sniffing for a
 * field, which is the kind of check that silently starts answering differently when either
 * shape gains a key.
 */
export type Identified = { profile: ProviderProfile } | { failed: IdentifyFailure }

/** The code exchanged for a token, and the token spent on a profile. */
export type Identify = (input: IdentifyInput) => Promise<Identified>

/** Somebody's picture, if it is bytes this app is willing to store. */
export type FetchPicture = (url: string) => Promise<{ bytes: Buffer; content_type: string } | undefined>

export interface OAuthCalls {
  identify: Identify
  picture: FetchPicture
}

/**
 * The body once, as both.
 *
 * Read once because a `Response` body can only be consumed once, and both readings are
 * wanted: the JSON when it parses, and the text either way — a failure's `said` is the only
 * thing that explains a provider answering something unexpected.
 *
 * Facebook answers form-encoded on some errors and a provider having a bad day answers HTML.
 * Neither is a crash; both are worth logging verbatim.
 */
const bodyOf = async (response: Response): Promise<{ json: unknown; said?: string }> => {
  const text = await response.text()
  const said = text.trim() === '' ? undefined : text.trim().slice(0, MAX_SAID)

  try {
    return { json: JSON.parse(text), ...(said === undefined ? {} : { said }) }
  } catch {
    return { json: undefined, ...(said === undefined ? {} : { said }) }
  }
}

/** Read rather than asserted: `stringField` is the same guard the profile readers use. */
const accessToken = (body: unknown): string | undefined => stringField(body, 'access_token')

/**
 * The provider's words without its parsed body.
 *
 * Spreading `bodyOf`'s result straight into a failure would carry `json` along with it — the
 * whole decoded answer into a log line, which is both more than a reader wants and more than
 * `IdentifyFailure` says it holds.
 */
const saidOnly = ({ said }: { said?: string }): { said?: string } => (said === undefined ? {} : { said })

export const identifyOverHttps: Identify = async ({
  provider,
  clientId,
  clientSecret,
  redirectUri,
  code,
  asks,
}) => {
  const shape = providerShapes[provider]

  try {
    const exchanged = await fetch(shape.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    const exchange = await bodyOf(exchanged)

    // Both the refusal and the 200 that carries no token, because the second is what a wrong
    // secret or an unapproved scope usually looks like — and the body says which.
    const token = exchanged.ok ? accessToken(exchange.json) : undefined
    if (token === undefined) {
      return { failed: { at: 'token', status: exchanged.status, ...saidOnly(exchange) } }
    }

    const identified = await fetch(shape.profile(asks), {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    const answered = await bodyOf(identified)
    const profile = identified.ok ? shape.read(answered.json) : undefined
    if (profile === undefined) {
      return { failed: { at: 'profile', status: identified.status, ...saidOnly(answered) } }
    }

    return { profile }
  } catch (failure) {
    // Where a request never arrived at all: DNS, a refused connection, or the ten-second
    // timeout. `TimeoutError` against `ENOTFOUND` is the difference between a provider being
    // slow and a container with no outbound HTTPS, which is worth being able to tell apart.
    return {
      failed: {
        at: 'network',
        said: failure instanceof Error ? `${failure.name}: ${failure.message}`.slice(0, MAX_SAID) : undefined,
      },
    }
  }
}

/**
 * The picture, if it is a picture this app already knows how to serve.
 *
 * **Nothing here decodes an image**, which is the rule every other image path states — and
 * this is the only one whose bytes come from somewhere else entirely, so it is also the only
 * one that cannot lean on a browser having resized first. What stands in for that: the
 * provider was asked for a 256-pixel picture, the content type has to be one of the three
 * the avatar table's CHECK allows, and the length is capped at the same
 * `MAX_AVATAR_BYTES` the upload route uses. A provider answering something longer or of
 * another type is answered with nothing.
 */
export const fetchPictureOverHttps: FetchPicture = async (url) => {
  try {
    // The URL is whatever the provider's profile response named, so the scheme is pinned
    // rather than trusted. Only reachable if the provider itself answers hostilely, and a
    // cheap narrowing given nothing in this process decodes the bytes.
    if (!url.toLowerCase().startsWith('https://')) return undefined

    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) return undefined

    const content_type = AVATAR_TYPES.find(
      (candidate) => candidate === response.headers.get('content-type')?.split(';')[0]?.trim(),
    )
    if (content_type === undefined) return undefined

    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length === 0 || bytes.length > MAX_AVATAR_BYTES) return undefined

    return { bytes, content_type }
  } catch {
    return undefined
  }
}

export const httpsOAuth: OAuthCalls = { identify: identifyOverHttps, picture: fetchPictureOverHttps }
