import type { OAuthProvider } from '@sage-burner/shared'

import { facebookProfileLink } from '@sage-burner/shared'

/**
 * What each provider's endpoints are, and how to read what it answers (#393).
 *
 * Pure: no socket is opened here, so the shape of a provider is testable without one.
 * `client.ts` is the module that talks, exactly as `mail/smtp.ts` and `push/web-push.ts`
 * are the only two that do for theirs.
 */

/**
 * Facebook's API version — the one value in this file that goes stale on somebody else's
 * schedule, and the one that cannot be written from memory.
 *
 * **v26.0, released 2026-07-29.** The date is here so its age is readable: Meta ships roughly
 * two versions a year and retires each about two years on, so a constant with no date beside
 * it says nothing about whether it is current. This one first went in as `v21.0` — five
 * versions behind on the day it was written, because it was recalled rather than looked up.
 *
 * **It has to be at or below the app's own version**, which is the *Upgrade API Version* card
 * under Settings → Advanced in the developer console. A path version overrides that setting
 * for a single call, but only downwards: older versions stay callable, and Meta does not
 * document calling one newer than the app is on. So bumping this is half the job — the console
 * is the other half, and it is the half no code here can read.
 *
 * Not omitted from the path, which would be the other way to spell "latest": an unversioned
 * call resolves to whatever that same console card says, which makes every request depend on a
 * setting invisible from here. Pinned and stale is a bug somebody can see; unpinned and
 * drifting is not. Discord needs no equivalent — its endpoints carry no version at all.
 */
export const FACEBOOK_GRAPH_VERSION = 'v26.0'

/**
 * What this installation's app is allowed to ask a provider for.
 *
 * One flag today, and it is a flag rather than a constant because the scope is named in the
 * authorize redirect: an app that has not been approved for `user_link` cannot be recovered
 * from once somebody is standing at the consent screen (#405).
 */
export interface ProviderAsks {
  profileLink: boolean
}

/** What comes back about somebody, reduced to the few things this app has any use for. */
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
  /**
   * Where their own page at the provider is, when it was asked and answered with one.
   *
   * Absent for Discord, which has no profile URL — a username is a string you search for —
   * and absent for a Facebook app whose admin never asked for `user_link`.
   */
  profile_url?: string
}

export interface ProviderShape {
  /** Where somebody is sent to say yes. */
  authorize: string
  /** Where the code is exchanged for a token. */
  token: string
  /** Where the token reads a profile, given what this installation may ask for. */
  profile: (asks: ProviderAsks) => string
  /**
   * The least it can ask for.
   *
   * Neither includes `email`, and that is deliberate rather than minimal-by-habit: nothing
   * here matches on an address, so asking for one would collect what it must not use — and
   * Facebook's `email` needs review of its own.
   */
  scope: (asks: ProviderAsks) => string
  /** What the profile endpoint answered, if it is something this can use. */
  read: (body: unknown) => ProviderProfile | undefined
}

/**
 * A provider's JSON is `unknown`, and these two are how it is read rather than asserted.
 *
 * One type predicate, so the narrowing lives in a guard instead of a cast at each call
 * site — which is the difference between "avoid casting" and pretending to.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const field = (body: unknown, name: string): unknown => (isRecord(body) ? body[name] : undefined)

export const stringField = (body: unknown, name: string): string | undefined => {
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
    profile: () => 'https://discord.com/api/users/@me',
    // Nothing to add: Discord has no profile URL to ask for.
    scope: () => 'identify',
    read: (body) => {
      const subject = stringField(body, 'id')
      if (subject === undefined) return undefined

      return { subject, picture: discordPicture(subject, stringField(body, 'avatar')) }
    },
  },
  facebook: {
    authorize: `https://www.facebook.com/${FACEBOOK_GRAPH_VERSION}/dialog/oauth`,
    token: `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/oauth/access_token`,
    // Everything in one call rather than one per field, and the picture at the size the
    // avatar route stores: `AVATAR_PIXELS`.
    //
    // `link` is named only when the scope was. Whether Graph omits a field the token has no
    // permission for or refuses the whole read is not something this can find out without an
    // unapproved app to try it against, and a sign-in is the wrong place to guess: asked for
    // only when it can be granted, the question never arises.
    profile: ({ profileLink }) =>
      `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/me?fields=${[
        'id',
        'picture.width(256).height(256)',
        ...(profileLink ? ['link'] : []),
      ].join(',')}`,
    // `public_profile` is granted to every app. `user_link` is not: it is the admin's own
    // trip to app review, which is why it is a setting and off until they have made it.
    scope: ({ profileLink }) => (profileLink ? 'public_profile,user_link' : 'public_profile'),
    read: (body) => {
      const subject = stringField(body, 'id')
      if (subject === undefined) return undefined

      const data = field(field(body, 'picture'), 'data')
      // `is_silhouette` is Facebook saying "this is our placeholder, not them".
      const own = field(data, 'is_silhouette') !== true

      return {
        subject,
        picture: own ? stringField(data, 'url') : undefined,
        // Checked rather than trusted, since it becomes a link on a page other members read.
        profile_url: facebookProfileLink(stringField(body, 'link')),
      }
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
