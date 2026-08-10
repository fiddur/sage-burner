import type {
  ConnectionKind,
  IdentitiesResponse,
  OAuthIntent,
  OAuthOutcome,
  OAuthProvider,
} from '@sage-burner/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { apiRoutes, detailsPage, isOAuthProvider, loginPage } from '@sage-burner/shared'
import { and, eq, gt, lt } from 'drizzle-orm'
import { randomBytes, randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Config } from '../config.ts'
import type { IdentifyFailure, OAuthCalls } from '../oauth/client.ts'
import type { ProviderAsks, ProviderProfile } from '../oauth/providers.ts'

import { viewerFor } from '../auth/viewer.ts'
import { providerConnection } from '../connections.ts'
import { accountAvatar, accountConnection, accountIdentity, oauthState } from '../db/schema.ts'
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

export const STATE_TTL_SECONDS = 300

export const OAUTH_NONCE_COOKIE = 'sage_oauth'

// Said rather than hidden: the person who can fix it is somebody you know here.
const outcomeFor = ({ at, status }: IdentifyFailure): OAuthOutcome =>
  at === 'network' || (status ?? 0) >= 500 || status === 429 ? 'unreachable' : 'misconfigured'

export const registerOauthRoutes = (
  app: FastifyInstance,
  { db, sessions, now, config, oauth }: OAuthDeps,
) => {
  const back = (reply: FastifyReply, where: string) => reply.redirect(where)

  const redirectUri = (request: FastifyRequest, provider: OAuthProvider): string | undefined => {
    const origin = originOf(request, config)

    return origin === undefined ? undefined : `${origin}${apiRoutes.finishOauth.path(provider)}`
  }

  const providerOf = (value: string): OAuthProvider | undefined =>
    isOAuthProvider(value) ? value : undefined

  const asksFor = (setting: { ask_profile_link: boolean }): ProviderAsks => ({
    profileLink: setting.ask_profile_link,
  })

  const mintState = async (provider: OAuthProvider, intent: OAuthIntent, account_id: string | null) => {
    const state = randomBytes(32).toString('base64url')
    const nonce = randomBytes(32).toString('base64url')
    const stamp = now()

    await db
      .delete(oauthState)
      .where(lt(oauthState.created_at, new Date(stamp.getTime() - STATE_TTL_SECONDS * 1000).toISOString()))

    await db
      .insert(oauthState)
      .values({ state, provider, intent, nonce, account_id, created_at: stamp.toISOString() })

    return { state, nonce }
  }

  const nonceCookie = (value: string, maxAgeSeconds: number) =>
    [
      `${OAUTH_NONCE_COOKIE}=${value}`,
      'HttpOnly',
      'SameSite=Lax',
      'Path=/api',
      `Max-Age=${maxAgeSeconds}`,
      ...(config.secure_cookies ? ['Secure'] : []),
    ].join('; ')

  const nonceFrom = (header: string | undefined): string | undefined => {
    const present = (header ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${OAUTH_NONCE_COOKIE}=`))

    if (present.length !== 1) return undefined

    const value = present[0]?.slice(OAUTH_NONCE_COOKIE.length + 1)

    return value === undefined || value === '' ? undefined : value
  }

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

      const viewer = intent === 'link' ? await viewerFor(request, { db, sessions }) : undefined
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

    if (profile.profile_url !== undefined) {
      try {
        await db
          .update(accountIdentity)
          .set({ profile_url: profile.profile_url })
          .where(eq(accountIdentity.id, identity.id))
      } catch {}
    }

    void reply.header(
      'set-cookie',
      cookieHeader(sessions.issue(identity.account_id), config, config.session_ttl_seconds),
    )

    return back(reply, '/')
  }

  const maybeReach = async (
    accountId: string,
    provider: OAuthProvider,
    reach: { kind: ConnectionKind; value: string } | undefined,
  ): Promise<boolean> => {
    if (reach === undefined) return false

    const held = await db
      .select({ kind: accountConnection.kind, order: accountConnection.order })
      .from(accountConnection)
      .where(eq(accountConnection.account_id, accountId))

    const row = providerConnection(accountId, provider, reach, held)
    if (row === undefined) return false

    await db.insert(accountConnection).values(row)

    return true
  }

  const link = async (
    reply: FastifyReply,
    provider: OAuthProvider,
    accountId: string | null,
    profile: ProviderProfile,
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
      return back(reply, detailsPage('taken'))
    }

    try {
      await maybeAvatar(accountId, profile.picture)
    } catch {}

    let reached = false
    try {
      reached = await maybeReach(accountId, provider, profile.reach)
    } catch {}

    return back(reply, detailsPage(reached ? 'reached' : 'linked'))
  }

  app.get<{ Params: { provider: string }; Querystring: { code?: string; state?: string } }>(
    apiRoutes.finishOauth.fastify,
    async (request, reply) => {
      void noStore(reply)

      const provider = providerOf(request.params.provider)
      if (provider === undefined) return sendError(reply, 404)

      const { code, state } = request.query
      if (typeof code !== 'string' || typeof state !== 'string') {
        return back(reply, loginPage('refused'))
      }

      const spent = await spendState(state)
      if (spent === undefined) return back(reply, loginPage('refused'))

      const failed = spent.intent === 'sign-in' ? loginPage('refused') : detailsPage('refused')

      void reply.header('set-cookie', nonceCookie('', 0))

      if (spent.provider !== provider) return back(reply, failed)
      if (nonceFrom(request.headers.cookie) !== spent.nonce) return back(reply, failed)

      const setting = await usableOauthSetting(db, provider)
      const uri = redirectUri(request, provider)
      if (setting === undefined || uri === undefined) return back(reply, failed)

      const identified = await oauth.identify({
        provider,
        clientId: setting.client_id,
        clientSecret: setting.client_secret,
        redirectUri: uri,
        code,
        asks: asksFor(setting),
      })

      if ('failed' in identified) {
        request.log.warn(
          { provider, intent: spent.intent, ...identified.failed },
          'could not identify somebody at a provider',
        )

        const kind = outcomeFor(identified.failed)

        return back(
          reply,
          spent.intent === 'sign-in'
            ? loginPage(kind, String(request.id))
            : detailsPage(kind, String(request.id)),
        )
      }

      return spent.intent === 'sign-in'
        ? await signIn(reply, provider, identified.profile)
        : await link(reply, provider, spent.account_id, identified.profile)
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

    const gone = await db
      .delete(accountIdentity)
      .where(and(eq(accountIdentity.id, mine.id), anotherWayInSurvives(viewer.account_id, provider)))
      .returning({ id: accountIdentity.id })

    if (gone.length === 0) return sendError(reply, 409)

    await db
      .delete(accountConnection)
      .where(
        and(
          eq(accountConnection.account_id, viewer.account_id),
          eq(accountConnection.from_provider, provider),
        ),
      )

    return reply.code(204).send()
  })
}
