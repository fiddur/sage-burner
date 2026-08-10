import type { IdentitiesResponse, OAuthIntent, OAuthProvider } from '@sage-burner/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { apiRoutes, detailsPage, isOAuthProvider, loginPage } from '@sage-burner/shared'
import { and, eq, gt, lt } from 'drizzle-orm'
import { randomBytes, randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Config } from '../config.ts'
import type { OAuthCalls } from '../oauth/client.ts'
import type { ProviderAsks } from '../oauth/providers.ts'

import { viewerFor } from '../auth/viewer.ts'
import { accountAvatar, accountIdentity, oauthState } from '../db/schema.ts'
import { noStore, sendError } from '../http.ts'
import { anotherWayInSurvives, identitiesFor } from '../oauth/identities.ts'
import { authorizeUrl } from '../oauth/providers.ts'
import { usableOauthSetting } from '../oauth/settings.ts'
import { originOf } from '../shell.ts'
import { cookieHeader } from './auth.ts'

export interface OAuthDeps extends GuardDeps {
  now: () => Date
  config: Config
  oauth: OAuthCalls
}

/**
 * How long a half-finished round trip stays usable.
 *
 * `webauthn_challenge`'s five minutes, for the same reason: long enough for somebody to
 * read a consent screen, short enough that an abandoned one is not lying around.
 */
export const STATE_TTL_SECONDS = 300

/** What the browser is given to prove it is the one that left. */
export const OAUTH_NONCE_COOKIE = 'sage_oauth'

/**
 * Signing in from Discord or Facebook, and linking one to an account (#393).
 *
 * **This never creates an account.** Accounts here come from the CLI bootstrap, an approved
 * application's invite, or a direct admin invite — the login page says so, and a burn's
 * membership gate is the whole point of the application form. So the link is made from Your
 * details by somebody already signed in, and signing in matches a stored identity or refuses.
 *
 * **Never matched on an email address.** A provider's address is an account-takeover path
 * the moment one hands over an address it did not verify, and matching on it would make the
 * button an oracle for which addresses have accounts here — which the usernameless passkey
 * login went out of its way not to be. Neither provider is even asked for one.
 *
 * The routes answer redirects rather than JSON, because a provider round trip is a series of
 * top-level navigations. What went wrong comes back as a reason in the URL, worded by the
 * page: `unlinked` says nothing about whether an account exists.
 */
export const registerOauthRoutes = (
  app: FastifyInstance,
  { db, sessions, now, config, oauth }: OAuthDeps,
) => {
  const back = (reply: FastifyReply, where: string) => reply.redirect(where)

  /**
   * Where the provider sends somebody back to, absolutely.
   *
   * This app has no notion of its own address, so it is `originOf` — `PUBLIC_ORIGIN` winning
   * — and it has to match what is registered with the provider exactly. A `Host` that is not
   * hostname-shaped gets nothing rather than a URL nobody can return to.
   */
  const redirectUri = (request: FastifyRequest, provider: OAuthProvider): string | undefined => {
    const origin = originOf(request, config)

    return origin === undefined ? undefined : `${origin}${apiRoutes.finishOauth.path(provider)}`
  }

  const providerOf = (value: string): OAuthProvider | undefined =>
    isOAuthProvider(value) ? value : undefined

  /**
   * What this installation's app may ask for, read off the same row both legs read.
   *
   * Both have to agree — the authorize redirect names the scope and the profile read names the
   * fields — and reading it twice from one place is what makes that true without either leg
   * carrying the answer through the round trip.
   */
  const asksFor = (setting: { ask_profile_link: boolean }): ProviderAsks => ({
    profileLink: setting.ask_profile_link,
  })

  /**
   * A state and the nonce that ties it to this browser.
   *
   * 32 CSPRNG bytes each, like an invite token. The nonce goes back as a short-lived cookie
   * and its twin stays in the row, so finishing the trip takes both — the state from the
   * provider's redirect and the cookie from the browser that started it. Without that pairing
   * the two legs are unrelated, and RFC 6749 §10.12 is about exactly this.
   */
  const mintState = async (provider: OAuthProvider, intent: OAuthIntent, account_id: string | null) => {
    const state = randomBytes(32).toString('base64url')
    const nonce = randomBytes(32).toString('base64url')
    const stamp = now()

    // Swept here rather than on a schedule, which is `mintChallenge`'s argument: leaving for
    // a provider is the only thing that makes these, so it is also the only thing that can
    // leave them behind — and an abandoned consent screen is the ordinary case, on a route
    // anybody can reach.
    await db
      .delete(oauthState)
      .where(lt(oauthState.created_at, new Date(stamp.getTime() - STATE_TTL_SECONDS * 1000).toISOString()))

    await db
      .insert(oauthState)
      .values({ state, provider, intent, nonce, account_id, created_at: stamp.toISOString() })

    return { state, nonce }
  }

  /**
   * The nonce cookie: `Lax`, because it has to survive the provider's top-level redirect
   * back, and `HttpOnly` because nothing on the page has any use for it.
   *
   * Scoped to `/api` rather than `/`, so it is not sent with every page load — it is only
   * ever read by the callback.
   */
  const nonceCookie = (value: string, maxAgeSeconds: number) =>
    [
      `${OAUTH_NONCE_COOKIE}=${value}`,
      'HttpOnly',
      'SameSite=Lax',
      'Path=/api',
      `Max-Age=${maxAgeSeconds}`,
      ...(config.secure_cookies ? ['Secure'] : []),
    ].join('; ')

  /**
   * The nonce this browser was given, if it was given exactly one.
   *
   * Counted rather than first-wins, which is `readSessionCookie`'s reasoning: a planted
   * duplicate must not be able to decide which value is read.
   */
  const nonceFrom = (header: string | undefined): string | undefined => {
    const present = (header ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${OAUTH_NONCE_COOKIE}=`))

    if (present.length !== 1) return undefined

    const value = present[0]?.slice(OAUTH_NONCE_COOKIE.length + 1)

    return value === undefined || value === '' ? undefined : value
  }

  /**
   * The state, spent.
   *
   * Delete-with-returning, so single-use is a property of the statement rather than of two
   * statements being run in the right order — `spendChallenge` in `passkeys.ts` for the same
   * reason.
   */
  const spendState = async (state: string) => {
    const fresh = new Date(now().getTime() - STATE_TTL_SECONDS * 1000).toISOString()
    const [row] = await db
      .delete(oauthState)
      .where(and(eq(oauthState.state, state), gt(oauthState.created_at, fresh)))
      .returning()

    return row
  }

  const leaving =
    (intent: OAuthIntent) =>
    async (request: FastifyRequest<{ Params: { provider: string } }>, reply: FastifyReply) => {
      void noStore(reply)

      const provider = providerOf(request.params.provider)
      if (provider === undefined) return sendError(reply, 404)

      const failed = intent === 'sign-in' ? loginPage('refused') : detailsPage('refused')

      // Somebody signed in is who a link is for, and the state remembers *which* account, so
      // a callback cannot attach an identity to anybody else by arriving with another cookie.
      // No role is required: an account with no role yet still has to be able to add a way in
      // and get back in with it, which is #9's rule for passkeys.
      const viewer = intent === 'link' ? await viewerFor(request, { db, sessions }) : undefined
      // A redirect rather than a JSON 401: this is reached by a plain `<a href>`, so an
      // expired session would otherwise put an error envelope on the screen.
      if (intent === 'link' && viewer === undefined) return back(reply, loginPage())

      const setting = await usableOauthSetting(db, provider)
      const uri = redirectUri(request, provider)
      if (setting === undefined || uri === undefined) return back(reply, failed)

      const { state, nonce } = await mintState(provider, intent, viewer?.account_id ?? null)

      void reply.header('set-cookie', nonceCookie(nonce, STATE_TTL_SECONDS))

      return back(
        reply,
        authorizeUrl(provider, {
          clientId: setting.client_id,
          redirectUri: uri,
          state,
          asks: asksFor(setting),
        }),
      )
    }

  app.get<{ Params: { provider: string } }>(apiRoutes.startOauthSignIn.fastify, leaving('sign-in'))
  app.get<{ Params: { provider: string } }>(apiRoutes.startOauthLink.fastify, leaving('link'))

  /**
   * Their picture, if they have one and this account has none.
   *
   * Only when there is none: a picture somebody chose here is theirs, and a provider's is
   * only a better start than initials. Failures are swallowed — a link must not fail because
   * a CDN did, which is the rule push and email already follow.
   */
  const maybeAvatar = async (accountId: string, picture: string | undefined) => {
    if (picture === undefined) return

    const [held] = await db
      .select({ account_id: accountAvatar.account_id })
      .from(accountAvatar)
      .where(eq(accountAvatar.account_id, accountId))
      .limit(1)
    if (held !== undefined) return

    const fetched = await oauth.picture(picture)
    if (fetched === undefined) return

    await db.insert(accountAvatar).values({
      account_id: accountId,
      image: fetched.bytes,
      content_type: fetched.content_type,
      updated_at: now().toISOString(),
    })
  }

  /**
   * Somebody coming back to sign in.
   *
   * Matches the stored identity and nothing else — never an email address, which would be a
   * takeover path and an oracle both. `unlinked` reads the same whether or not an account
   * exists for whatever the provider holds.
   */
  const signIn = async (
    reply: FastifyReply,
    provider: OAuthProvider,
    profile: { subject: string; profile_url?: string },
  ) => {
    const [identity] = await db
      .select({ id: accountIdentity.id, account_id: accountIdentity.account_id })
      .from(accountIdentity)
      .where(and(eq(accountIdentity.provider, provider), eq(accountIdentity.subject, profile.subject)))
      .limit(1)

    if (identity === undefined) return back(reply, loginPage('unlinked'))

    // Refreshed here and not only at link time, which is what makes the feature reach somebody
    // who linked before the installation asked for the scope — otherwise their only route to a
    // profile link would be to unlink and link again. A vanity name that changes lands here
    // too. Swallowed like the avatar: a sign-in must not fail over a cosmetic column.
    if (profile.profile_url !== undefined) {
      try {
        await db
          .update(accountIdentity)
          .set({ profile_url: profile.profile_url })
          .where(eq(accountIdentity.id, identity.id))
      } catch {
        /* empty */
      }
    }

    void reply.header(
      'set-cookie',
      cookieHeader(sessions.issue(identity.account_id), config, config.session_ttl_seconds),
    )

    return back(reply, '/')
  }

  /**
   * Somebody coming back to add a way in.
   *
   * The account comes from the state rather than the cookie, so a callback cannot attach an
   * identity to somebody else by arriving as them.
   */
  const link = async (
    reply: FastifyReply,
    provider: OAuthProvider,
    accountId: string | null,
    profile: { subject: string; picture?: string; profile_url?: string },
  ) => {
    if (accountId === null) return back(reply, detailsPage('refused'))

    try {
      await db.insert(accountIdentity).values({
        id: randomUUID(),
        account_id: accountId,
        provider,
        subject: profile.subject,
        profile_url: profile.profile_url ?? null,
        created_at: now().toISOString(),
      })
    } catch {
      // Either this provider account is already somebody's, or this account already has one
      // of this provider. Both are `taken` from where the page stands, and neither is worth
      // telling somebody which — the second is their own row, and the first is not theirs to
      // know about.
      return back(reply, detailsPage('taken'))
    }

    // Must not cost somebody the link they just made: a CDN having a bad day is not a reason
    // to undo an identity that is already written.
    try {
      await maybeAvatar(accountId, profile.picture)
    } catch {
      /* empty */
    }

    return back(reply, detailsPage('linked'))
  }

  app.get<{ Params: { provider: string }; Querystring: { code?: string; state?: string } }>(
    apiRoutes.finishOauth.fastify,
    async (request, reply) => {
      void noStore(reply)

      const provider = providerOf(request.params.provider)
      if (provider === undefined) return sendError(reply, 404)

      const { code, state } = request.query
      // Before the state is spent: with nothing to spend it on, spending it would turn a
      // provider's error redirect into a state somebody has to start again for.
      if (typeof code !== 'string' || typeof state !== 'string') {
        return back(reply, loginPage('refused'))
      }

      const spent = await spendState(state)
      if (spent === undefined) return back(reply, loginPage('refused'))

      const failed = spent.intent === 'sign-in' ? loginPage('refused') : detailsPage('refused')

      // The cookie is cleared whatever happens next: the state is spent either way, and a
      // nonce left behind is one a later trip would have to reason about.
      void reply.header('set-cookie', nonceCookie('', 0))

      // Both halves, and the second is the one that matters: the state proves the provider
      // sent this, and the nonce proves it came back to the browser that left. Neither alone
      // says the party finishing the trip is the party who started it.
      if (spent.provider !== provider) return back(reply, failed)
      if (nonceFrom(request.headers.cookie) !== spent.nonce) return back(reply, failed)

      const setting = await usableOauthSetting(db, provider)
      const uri = redirectUri(request, provider)
      if (setting === undefined || uri === undefined) return back(reply, failed)

      const profile = await oauth.identify({
        provider,
        clientId: setting.client_id,
        clientSecret: setting.client_secret,
        redirectUri: uri,
        code,
        asks: asksFor(setting),
      })
      if (profile === undefined) return back(reply, failed)

      return spent.intent === 'sign-in'
        ? await signIn(reply, provider, profile)
        : await link(reply, provider, spent.account_id, profile)
    },
  )

  app.get(apiRoutes.getMyIdentities.fastify, async (request, reply) => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    return { identities: await identitiesFor(db, viewer.account_id) } satisfies IdentitiesResponse
  })

  app.delete<{ Params: { provider: string } }>(apiRoutes.removeMyIdentity.fastify, async (request, reply) => {
    void noStore(reply)

    const provider = providerOf(request.params.provider)
    if (provider === undefined) return sendError(reply, 404)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    const [mine] = await db
      .select({ id: accountIdentity.id })
      .from(accountIdentity)
      .where(and(eq(accountIdentity.account_id, viewer.account_id), eq(accountIdentity.provider, provider)))
      .limit(1)

    if (mine === undefined) return sendError(reply, 404)

    // The last way in cannot go. `removePasskey` refuses the same thing for the same
    // reason: an account nobody can sign into is not a tidier account. The guard is inside
    // the statement — `anotherWayInSurvives` says why.
    const gone = await db
      .delete(accountIdentity)
      .where(and(eq(accountIdentity.id, mine.id), anotherWayInSurvives(viewer.account_id, provider)))
      .returning({ id: accountIdentity.id })

    // The row was there a moment ago and this is the owner's own request, so the only thing
    // that matches nothing is the guard.
    if (gone.length === 0) return sendError(reply, 409)

    return reply.code(204).send()
  })
}
