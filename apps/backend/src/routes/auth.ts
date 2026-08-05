import type { MeResponse, Viewer } from '@sage-burner/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { errorResponse, loginRequestSchema } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'

import type { Gate } from '../auth/gate.ts'
import type { Sessions } from '../auth/session.ts'
import type { Config } from '../config.ts'
import type { Database } from '../db/index.ts'

import { hashPassword, needsRehash, verifyPassword } from '../auth/password.ts'
import { SESSION_COOKIE, viewerFor } from '../auth/viewer.ts'
import { account, accountAvatar, accountRole } from '../db/schema.ts'
import { noStore } from '../http.ts'

/**
 * The cookie carrying the session token.
 *
 * - `HttpOnly` so an XSS cannot read it. This is the one that matters most: the
 *   token *is* the session, and script access would make stealing it trivial.
 * - `SameSite=Lax` so it rides normal navigation but not a cross-site POST,
 *   which is most of CSRF for free. Not `Strict`, which would drop the cookie
 *   when a member follows an invite link out of Discord and lands signed-out on
 *   a page they are signed in to.
 * - `Secure` whenever `config.secure_cookies` — production, a non-loopback
 *   `HOST`, or a set `WEB_ROOT`. The image is all three, so every containerised
 *   deployment gets it; the environment without it is `pnpm dev`, which is none
 *   of them.
 *
 *   The third signal is the one that matters most and is easiest to overlook: a
 *   `pnpm start` behind a proxy is neither production nor non-loopback — the
 *   proxy is *why* it binds loopback — and serving the built frontend is the
 *   only thing marking its cookie `Secure`.
 *
 *   Keyed off the same predicate as the `SESSION_SECRET` guard rather than off
 *   `NODE_ENV`, because `NODE_ENV` cannot answer "is this reachable" — it
 *   defaults to `development` when unset. Before that, a hand-rolled
 *   `SESSION_SECRET=… HOST=0.0.0.0 node src/server.ts` bound every interface and
 *   issued the cookie *without* `Secure`; behind a proxy that also answers on
 *   `:80` the browser then sends it in cleartext, and the token is the session
 *   with no server-side revocation.
 *
 *   Consequence worth knowing rather than working around: over plain HTTP on a
 *   non-`localhost` origin, the browser silently discards the cookie. The login
 *   still answers 200 and the UI renders signed-in from the response body, then
 *   the next page load comes back signed out with nothing explaining why.
 *   `localhost` escapes this only because browsers treat it as a trustworthy
 *   origin — a different reason from the one this once claimed, and not one
 *   applied uniformly. Plain HTTP therefore works on `localhost`; anything else
 *   needs TLS in front.
 * - `Path=/` because the SPA and the API share an origin.
 */
export const cookieHeader = (token: string, config: Config, maxAgeSeconds: number): string => {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (config.secure_cookies) parts.push('Secure')
  return parts.join('; ')
}

const rolesFor = async (db: Database, accountId: string) => {
  const rows = await db
    .select({ role: accountRole.role })
    .from(accountRole)
    .where(eq(accountRole.account_id, accountId))

  return rows.map((row) => row.role)
}

export interface AuthRouteDeps {
  db: Database
  config: Config
  sessions: Sessions
  /** The scrypt gate, shared with redemption. See `SCRYPT_GATE`. */
  gate: Gate
}

export const registerAuthRoutes = (app: FastifyInstance, { db, config, sessions, gate }: AuthRouteDeps) => {
  const handleLogin = async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = loginRequestSchema.safeParse(request.body)

    if (!parsed.success) {
      // Deliberately not `bad_request`: a malformed body and a wrong password
      // must be indistinguishable, or the shape of the error tells an attacker
      // whether an address parses as an account.
      return reply.code(401).send(errorResponse('invalid_credentials'))
    }

    const [row] = await db
      .select({
        id: account.id,
        name: account.name,
        avatar: accountAvatar.updated_at,
        password_hash: account.password_hash,
      })
      .from(account)
      // Left: most accounts have no picture, and the circle falls back to initials.
      .leftJoin(accountAvatar, eq(accountAvatar.account_id, account.id))
      .where(eq(account.email, parsed.data.email))
      .limit(1)

    // Deliberately no early return when `row` is undefined: `verifyPassword`
    // spends the same work on a null hash as on a real one, so an unknown
    // address and a wrong password take the same time. That property lives
    // there, with the measurement that motivated it — this line only has to
    // avoid short-circuiting past it.
    const stored = row?.password_hash ?? null
    const ok = await verifyPassword(parsed.data.password, stored, {
      // Without this a broken hashing setup is indistinguishable from every
      // member mistyping at once: same 401, same body, same latency.
      onError: (error) => {
        request.log.error({ err: error }, 'password verification failed')
      },
    })

    if (!ok || row === undefined) {
      request.log.info({ status: 401 }, 'login rejected')
      return reply.code(401).send(errorResponse('invalid_credentials'))
    }

    // Opportunistic upgrade: the parameters have to rise as hardware does, and
    // a successful login is the only moment the plaintext is available to
    // re-hash with. Failure here must not fail the login.
    if (stored !== null && needsRehash(stored)) {
      try {
        const upgraded = await hashPassword(parsed.data.password)
        await db.update(account).set({ password_hash: upgraded }).where(eq(account.id, row.id))
      } catch (error) {
        request.log.error({ err: error }, 'password rehash failed')
      }
    }

    // Roles first, then the cookie. The other order reads more naturally and is
    // wrong: `reply.header` sticks to the reply, so a database failure in
    // `rolesFor` answers 500 with a valid session cookie already attached — the
    // member is told the login failed while being signed in, and the next
    // request succeeds for no reason they can see. Nothing is issued until
    // every query that can fail has succeeded.
    const roles = await rolesFor(db, row.id)

    void reply.header('set-cookie', cookieHeader(sessions.issue(row.id), config, config.session_ttl_seconds))

    return reply.code(200).send({
      viewer: { account_id: row.id, name: row.name, avatar: row.avatar, roles } satisfies Viewer,
    } satisfies MeResponse)
  }

  app.post('/api/auth/login', async (request, reply) => {
    void noStore(reply)

    // Taken before any work, so the bound cannot depend on what the database
    // driver does between a check and a claim.
    const admission = await gate.enter()

    if (!admission.ok) {
      void reply.header('retry-after', gate.retryAfter(admission.reason))
      request.log.warn({ ...gate.stats(), reason: admission.reason }, 'login shed')
      return reply.code(429).send(errorResponse('rate_limited'))
    }

    try {
      return await handleLogin(request, reply)
    } finally {
      admission.release()
    }
  })

  app.post('/api/auth/logout', async (_request, reply: FastifyReply) => {
    void noStore(reply)
    // Max-Age=0 rather than omitting the cookie: the browser has to be told to
    // drop it. The token itself stays valid until it expires — sessions are
    // signed, not stored, so there is nothing server-side to revoke. That trade
    // is argued in `auth/session.ts`.
    void reply.header('set-cookie', cookieHeader('', config, 0))
    return reply.code(200).send({ viewer: null } satisfies MeResponse)
  })

  app.get('/api/auth/me', async (request, reply) => {
    void noStore(reply)

    // 200 with a null viewer, not 401: an anonymous visitor loading the public
    // homepage is the expected case, and the client should not have to treat it
    // as a failure to render a signed-out page.
    const viewer = (await viewerFor(request, { db, sessions })) ?? null
    return reply.code(200).send({ viewer } satisfies MeResponse)
  })
}
