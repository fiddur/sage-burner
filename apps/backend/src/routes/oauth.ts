import type { IdentitiesResponse, OAuthIntent, OAuthProvider } from '@sage-burner/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import {
  apiRoutes,
  connectionValue,
  detailsPage,
  isOAuthProvider,
  loginPage,
  MAX_CONNECTIONS,
} from '@sage-burner/shared'
import { and, asc, eq, gt } from 'drizzle-orm'
import { randomBytes, randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Config } from '../config.ts'
import type { OAuthCalls } from '../oauth/client.ts'

import { viewerFor } from '../auth/viewer.ts'
import { nextOrder } from '../db/ordered.ts'
import { accountAvatar, accountConnection, accountIdentity, oauthState } from '../db/schema.ts'
import { noStore, sendError } from '../http.ts'
import { hasAnotherWayIn, identitiesFor } from '../oauth/identities.ts'
import { authorizeUrl } from '../oauth/providers.ts'
import { oauthSettingFor } from '../oauth/settings.ts'
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

  /** 32 CSPRNG bytes, like an invite token: a state nobody can guess or replay. */
  const mintState = async (provider: OAuthProvider, intent: OAuthIntent, account_id: string | null) => {
    const state = randomBytes(32).toString('base64url')

    await db
      .insert(oauthState)
      .values({ state, provider, intent, account_id, created_at: now().toISOString() })

    return state
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
      if (intent === 'link' && viewer === undefined) return sendError(reply, 401)

      const setting = await oauthSettingFor(db, provider)
      const uri = redirectUri(request, provider)
      if (setting === undefined || uri === undefined) return back(reply, failed)

      const state = await mintState(provider, intent, viewer?.account_id ?? null)

      return back(reply, authorizeUrl(provider, { clientId: setting.client_id, redirectUri: uri, state }))
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
   * A way to be reached, from the account just linked.
   *
   * Only Facebook, and only as **Messenger**: Facebook as a way of being reached is the
   * `m.me` link, and looking at somebody's page is a different act that the profile draws
   * from the identity itself. Only when they have none of that kind, so this never argues
   * with a handle somebody typed — and it goes on the end of their list, because where in the
   * order it belongs is theirs to say.
   */
  const maybeMessenger = async (accountId: string, provider: OAuthProvider, subject: string) => {
    if (provider !== 'facebook') return

    const held = await db
      .select({ id: accountConnection.id, kind: accountConnection.kind })
      .from(accountConnection)
      .where(eq(accountConnection.account_id, accountId))
      .orderBy(asc(accountConnection.order))

    if (held.length >= MAX_CONNECTIONS || held.some((row) => row.kind === 'messenger')) return

    db.transaction((tx) => {
      const order = nextOrder(tx, accountConnection, eq(accountConnection.account_id, accountId))
      tx.insert(accountConnection)
        .values({
          id: randomUUID(),
          account_id: accountId,
          kind: 'messenger',
          value: connectionValue('messenger', subject),
          label: '',
          order,
        })
        .run()
    })
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
      if (spent === undefined || spent.provider !== provider) return back(reply, loginPage('refused'))

      const failed = spent.intent === 'sign-in' ? loginPage('refused') : detailsPage('refused')

      const setting = await oauthSettingFor(db, provider)
      const uri = redirectUri(request, provider)
      if (setting === undefined || uri === undefined) return back(reply, failed)

      const profile = await oauth.identify({
        provider,
        clientId: setting.client_id,
        clientSecret: setting.client_secret,
        redirectUri: uri,
        code,
      })
      if (profile === undefined) return back(reply, failed)

      if (spent.intent === 'sign-in') {
        const [identity] = await db
          .select({ account_id: accountIdentity.account_id })
          .from(accountIdentity)
          .where(and(eq(accountIdentity.provider, provider), eq(accountIdentity.subject, profile.subject)))
          .limit(1)

        // Nobody has linked this. Deliberately the same answer whether or not an account
        // exists for whatever address the provider holds: nothing here is an oracle.
        if (identity === undefined) return back(reply, loginPage('unlinked'))

        void reply.header(
          'set-cookie',
          cookieHeader(sessions.issue(identity.account_id), config, config.session_ttl_seconds),
        )

        return back(reply, '/')
      }

      const account_id = spent.account_id
      if (account_id === null) return back(reply, detailsPage('refused'))

      try {
        await db.insert(accountIdentity).values({
          id: randomUUID(),
          account_id,
          provider,
          subject: profile.subject,
          created_at: now().toISOString(),
        })
      } catch {
        // Either this provider account is already somebody's, or this account already has one
        // of this provider. Both are `taken` from where the page stands, and neither is worth
        // telling somebody which — the second is their own row and the first is not theirs to
        // know about.
        return back(reply, detailsPage('taken'))
      }

      // Neither of these may cost somebody the link they just made.
      try {
        await maybeAvatar(account_id, profile.picture)
        await maybeMessenger(account_id, provider, profile.subject)
      } catch {
        // Logged by nothing on purpose: the link is done, and the two extras are conveniences.
      }

      return back(reply, detailsPage('linked'))
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

    // The last way in cannot go. `removePasskey` refuses the same thing for the same
    // reason: an account nobody can sign into is not a tidier account.
    if (!(await hasAnotherWayIn(db, viewer.account_id, provider))) return sendError(reply, 409)

    const [gone] = await db
      .delete(accountIdentity)
      .where(and(eq(accountIdentity.account_id, viewer.account_id), eq(accountIdentity.provider, provider)))
      .returning({ id: accountIdentity.id })

    if (gone === undefined) return sendError(reply, 404)

    return reply.code(204).send()
  })
}
