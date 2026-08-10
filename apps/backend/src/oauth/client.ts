import type { OAuthProvider } from '@sage-burner/shared'

import type { ProviderAsks, ProviderProfile } from './providers.ts'

import { AVATAR_TYPES, MAX_AVATAR_BYTES } from '../routes/avatars.ts'
import { providerShapes, stringField } from './providers.ts'

const TIMEOUT_MS = 10_000
const MAX_SAID = 300

export interface IdentifyInput {
  provider: OAuthProvider
  clientId: string
  clientSecret: string
  redirectUri: string
  code: string
  asks: ProviderAsks
}

export interface IdentifyFailure {
  at: 'token' | 'profile' | 'network'
  status?: number
  said?: string
}

export type Identified = { profile: ProviderProfile } | { failed: IdentifyFailure }

export type Identify = (input: IdentifyInput) => Promise<Identified>

export type FetchPicture = (url: string) => Promise<{ bytes: Buffer; content_type: string } | undefined>

export interface OAuthCalls {
  identify: Identify
  picture: FetchPicture
}

const bodyOf = async (response: Response): Promise<{ json: unknown; said?: string }> => {
  const text = await response.text()
  const said = text.trim() === '' ? undefined : text.trim().slice(0, MAX_SAID)

  try {
    return { json: JSON.parse(text), ...(said === undefined ? {} : { said }) }
  } catch {
    return { json: undefined, ...(said === undefined ? {} : { said }) }
  }
}

const accessToken = (body: unknown): string | undefined => stringField(body, 'access_token')

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
      return {
        failed: {
          at: 'profile',
          status: identified.status,
          // Only a refusal's words: an ok answer here is the member's own profile.
          ...(identified.ok ? {} : saidOnly(answered)),
        },
      }
    }

    return { profile }
  } catch (failure) {
    return {
      failed: {
        at: 'network',
        said: failure instanceof Error ? `${failure.name}: ${failure.message}`.slice(0, MAX_SAID) : undefined,
      },
    }
  }
}

export const fetchPictureOverHttps: FetchPicture = async (url) => {
  try {
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
