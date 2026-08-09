import type { OAuthProvider } from '@sage-burner/shared'

/**
 * What each provider's endpoints are, and how to read what it answers (#393).
 *
 * Pure: no socket is opened here, so the shape of a provider is testable without one.
 * `client.ts` is the module that talks, exactly as `mail/smtp.ts` and `push/web-push.ts`
 * are the only two that do for theirs.
 */

/**
 * Facebook's API version, which is the one value in this file that goes stale on somebody
 * else's schedule.
 *
 * Meta pins each app to a version and retires old ones about every two years, so this has
 * to match what the app in the developer console is set to — check it there rather than
 * trusting this constant, which is only as current as whoever last edited it. Discord needs
 * no equivalent: its endpoints are unversioned in the path.
 */
export const FACEBOOK_GRAPH_VERSION = 'v21.0'

/** What comes back about somebody, reduced to the two things this app has any use for. */
export interface ProviderProfile {
  /** The provider's own id, which is the whole of what a sign-in matches. */
  subject: string
  /**
   * Where their picture is, when they have one that is really theirs.
   *
   * Absent for somebody using the provider's default silhouette: importing a grey
   * placeholder as an avatar would replace initials that at least say who somebody is.
   */
  picture?: string
}

export interface ProviderShape {
  /** Where somebody is sent to say yes. */
  authorize: string
  /** Where the code is exchanged for a token. */
  token: string
  /** Where the token reads a profile. */
  profile: string
  /**
   * The least it can ask for.
   *
   * Neither includes `email`, and that is deliberate rather than minimal-by-habit: nothing
   * here matches on an address, so asking for one would collect what it must not use — and
   * Facebook's `email` needs review of its own.
   */
  scope: string
  /** What the profile endpoint answered, if it is something this can use. */
  read: (body: unknown) => ProviderProfile | undefined
}

const field = (body: unknown, name: string): unknown =>
  typeof body === 'object' && body !== null && name in body
    ? (body as Record<string, unknown>)[name]
    : undefined

const stringField = (body: unknown, name: string): string | undefined => {
  const held = field(body, name)

  return typeof held === 'string' && held !== '' ? held : undefined
}

/**
 * Discord's picture, which is built rather than answered.
 *
 * `avatar` is a hash, and null for somebody who never set one — those get Discord's own
 * default, which is a coloured shape and no more them than initials are.
 */
const discordPicture = (id: string, avatar: string | undefined): string | undefined =>
  avatar === undefined ? undefined : `https://cdn.discordapp.com/avatars/${id}/${avatar}.png?size=256`

export const providerShapes = {
  discord: {
    authorize: 'https://discord.com/oauth2/authorize',
    token: 'https://discord.com/api/oauth2/token',
    profile: 'https://discord.com/api/users/@me',
    scope: 'identify',
    read: (body) => {
      const subject = stringField(body, 'id')
      if (subject === undefined) return undefined

      return { subject, picture: discordPicture(subject, stringField(body, 'avatar')) }
    },
  },
  facebook: {
    authorize: `https://www.facebook.com/${FACEBOOK_GRAPH_VERSION}/dialog/oauth`,
    token: `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/oauth/access_token`,
    // The picture is asked for in the same call rather than a second one, and at the size
    // the avatar route stores: `AVATAR_PIXELS`.
    profile: `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/me?fields=id,picture.width(256).height(256)`,
    scope: 'public_profile',
    read: (body) => {
      const subject = stringField(body, 'id')
      if (subject === undefined) return undefined

      const data = field(field(body, 'picture'), 'data')
      // `is_silhouette` is Facebook saying "this is our placeholder, not them".
      const own = field(data, 'is_silhouette') !== true

      return { subject, picture: own ? stringField(data, 'url') : undefined }
    },
  },
} as const satisfies Record<OAuthProvider, ProviderShape>

/**
 * Where a provider sends somebody to say yes.
 *
 * Built here rather than by the page, which is what keeps the redirect and the client id
 * from being a caller's claim about either.
 */
export const authorizeUrl = (
  provider: OAuthProvider,
  { clientId, redirectUri, state }: { clientId: string; redirectUri: string; state: string },
): string => {
  const shape = providerShapes[provider]
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: shape.scope,
    state,
  })

  return `${shape.authorize}?${query.toString()}`
}
