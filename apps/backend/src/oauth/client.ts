import type { OAuthProvider } from '@sage-burner/shared'

import type { ProviderProfile } from './providers.ts'

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
 * The routes turn `undefined` into a refusal they can word.
 */

const TIMEOUT_MS = 10_000

export interface IdentifyInput {
  provider: OAuthProvider
  clientId: string
  clientSecret: string
  redirectUri: string
  code: string
}

/** The code exchanged for a token, and the token spent on a profile. */
export type Identify = (input: IdentifyInput) => Promise<ProviderProfile | undefined>

/** Somebody's picture, if it is bytes this app is willing to store. */
export type FetchPicture = (url: string) => Promise<{ bytes: Buffer; content_type: string } | undefined>

export interface OAuthCalls {
  identify: Identify
  picture: FetchPicture
}

const jsonFrom = async (response: Response): Promise<unknown> => {
  const text = await response.text()

  try {
    return JSON.parse(text)
  } catch {
    // Facebook answers form-encoded on some errors, and a provider having a bad day
    // answers HTML. Neither is a crash.
    return undefined
  }
}

/** Read rather than asserted: `stringField` is the same guard the profile readers use. */
const accessToken = (body: unknown): string | undefined => stringField(body, 'access_token')

export const identifyOverHttps: Identify = async ({
  provider,
  clientId,
  clientSecret,
  redirectUri,
  code,
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

    if (!exchanged.ok) return undefined

    const token = accessToken(await jsonFrom(exchanged))
    if (token === undefined) return undefined

    const identified = await fetch(shape.profile, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!identified.ok) return undefined

    return shape.read(await jsonFrom(identified))
  } catch {
    return undefined
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
