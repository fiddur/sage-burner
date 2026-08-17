import type { ConnectionKind, OAuthProvider } from '@sage-burner/shared'

import { facebookProfileLink } from '@sage-burner/shared'

// Must be at or below the app's own version — Settings → Advanced in the developer console.
// Not omitted from the path: an unversioned call resolves to that same setting instead.
export const FACEBOOK_GRAPH_VERSION = 'v26.0'

export interface ProviderAsks {
  profileLink: boolean
}

export interface ProviderProfile {
  subject: string
  name?: string
  email?: string
  picture?: string
  profile_url?: string
  reach?: { kind: ConnectionKind; value: string }
}

export interface ProviderShape {
  authorize: string
  token: string
  profile: (asks: ProviderAsks) => string
  scope: (asks: ProviderAsks) => string
  read: (body: unknown) => ProviderProfile | undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const field = (body: unknown, name: string): unknown => (isRecord(body) ? body[name] : undefined)

export const stringField = (body: unknown, name: string): string | undefined => {
  const held = field(body, name)

  return typeof held === 'string' && held !== '' ? held : undefined
}

// An unverified address would let a stranger claim one they do not hold, so absent is better
// than wrong — the sign-up page asks for one instead.
const verifiedEmail = (body: unknown): string | undefined =>
  field(body, 'verified') === true ? stringField(body, 'email') : undefined

const discordPicture = (id: string, avatar: string | undefined): string | undefined =>
  avatar === undefined ? undefined : `https://cdn.discordapp.com/avatars/${id}/${avatar}.png?size=256`

export const providerShapes = {
  discord: {
    authorize: 'https://discord.com/oauth2/authorize',
    token: 'https://discord.com/api/oauth2/token',
    profile: () => 'https://discord.com/api/users/@me',
    // `email` because an account is keyed by an address. Discord answers a verified one;
    // Facebook is asked the same and often does not.
    scope: () => 'identify email',
    read: (body) => {
      const subject = stringField(body, 'id')
      if (subject === undefined) return undefined

      const username = stringField(body, 'username')

      return {
        subject,
        name: stringField(body, 'global_name') ?? username,
        email: verifiedEmail(body),
        picture: discordPicture(subject, stringField(body, 'avatar')),
        ...(username === undefined ? {} : { reach: { kind: 'discord' as const, value: username } }),
      }
    },
  },
  facebook: {
    authorize: `https://www.facebook.com/${FACEBOOK_GRAPH_VERSION}/dialog/oauth`,
    token: `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/oauth/access_token`,
    // `link` only where the scope was asked for: whether Graph omits an unpermitted field or
    // refuses the whole read is not answerable without an unapproved app to try.
    profile: ({ profileLink }) =>
      `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/me?fields=${[
        'id',
        'name',
        'email',
        'picture.width(256).height(256)',
        ...(profileLink ? ['link'] : []),
      ].join(',')}`,
    scope: ({ profileLink }) => (profileLink ? 'public_profile,email,user_link' : 'public_profile,email'),
    read: (body) => {
      const subject = stringField(body, 'id')
      if (subject === undefined) return undefined

      const data = field(field(body, 'picture'), 'data')
      const own = field(data, 'is_silhouette') !== true

      return {
        subject,
        name: stringField(body, 'name'),
        email: stringField(body, 'email'),
        picture: own ? stringField(data, 'url') : undefined,
        profile_url: facebookProfileLink(stringField(body, 'link')),
      }
    },
  },
} as const satisfies Record<OAuthProvider, ProviderShape>

export const authorizeUrl = (
  provider: OAuthProvider,
  {
    clientId,
    redirectUri,
    state,
    asks,
  }: { clientId: string; redirectUri: string; state: string; asks: ProviderAsks },
): string => {
  const shape = providerShapes[provider]
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: shape.scope(asks),
    state,
  })

  return `${shape.authorize}?${query.toString()}`
}
