import type { MeResponse, Viewer } from '@sage-burner/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { errorResponse, loginRequestSchema } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'

import type { Sessions } from '../auth/session.ts'
import type { Config } from '../config.ts'
import type { Database } from '../db/index.ts'

import { hashPassword, needsRehash, verifyPassword } from '../auth/password.ts'
import { account, accountRole } from '../db/schema.ts'

export const SESSION_COOKIE = 'sage_session'

/**
 * The cookie carrying the session token.
 *
 * - `HttpOnly` so an XSS cannot read it. This is the one that matters most: the
 *   token *is* the session, and script access would make stealing it trivial.
 * - `SameSite=Lax` so it rides normal navigation but not a cross-site POST,
 *   which is most of CSRF for free. Not `Strict`, which would drop the cookie
 *   when a member follows an invite link out of Discord and lands signed-out on
 *   a page they are signed in to.
 * - `Secure` in production only. Setting it unconditionally would make login
 *   silently fail on a plain-HTTP `docker compose up`, which the README
 *   promises works.
 * - `Path=/` because the SPA and the API share an origin.
 */
const cookieHeader = (token: string, config: Config, maxAgeSeconds: number): string => {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (config.node_env === 'production') parts.push('Secure')
  return parts.join('; ')
}

/**
 * Read the session cookie without a cookie-parsing dependency.
 *
 * One header, one name, and the token alphabet is base64url plus a dot — so
 * `decodeURIComponent` is not needed and a full parser buys nothing. Splits on
 * `;` and takes the first match, which is what a browser sends; a duplicate
 * name is not something a browser produces for a single `Path=/` cookie.
 */
export const readSessionCookie = (header: string | undefined): string | undefined => {
  if (header === undefined) return undefined

  for (const part of header.split(';')) {
    const trimmed = part.trim()
    if (!trimmed.startsWith(`${SESSION_COOKIE}=`)) continue

    const value = trimmed.slice(SESSION_COOKIE.length + 1)
    return value === '' ? undefined : value
  }

  return undefined
}

const rolesFor = async (db: Database, accountId: string) => {
  const rows = await db
    .select({ role: accountRole.role })
    .from(accountRole)
    .where(eq(accountRole.account_id, accountId))

  return rows.map((row) => row.role)
}

/**
 * The signed-in account, or undefined.
 *
 * Exported because the guards in #10 need exactly this and must not each
 * re-derive it. Returns undefined for a valid token whose account has since
 * been deleted — the signature proves the token was ours, not that the row
 * still exists.
 */
export const viewerFor = async (
  request: FastifyRequest,
  deps: { db: Database; sessions: Sessions },
): Promise<Viewer | undefined> => {
  const token = readSessionCookie(request.headers.cookie)
  if (token === undefined) return undefined

  const payload = deps.sessions.read(token)
  if (payload === undefined) return undefined

  const [row] = await deps.db
    .select({ id: account.id })
    .from(account)
    .where(eq(account.id, payload.account_id))
    .limit(1)

  if (row === undefined) return undefined

  return { account_id: row.id, roles: await rolesFor(deps.db, row.id) }
}

export interface AuthRouteDeps {
  db: Database
  config: Config
  sessions: Sessions
}

/**
 * Keep identity responses out of every cache.
 *
 * These are `GET`s and `POST`s carrying per-identity data with no
 * `Cache-Control`, `ETag` or `Last-Modified`, which makes them *heuristically*
 * cacheable — by the browser's own HTTP cache, which `fetch` uses by default,
 * and by any shared cache in front. The concrete failure is logout: the cookie
 * is gone, but a reload can still be answered from cache with the old
 * `{ viewer: … }` — and since sessions are signed rather than stored, there is
 * no server-side check to catch it.
 *
 * Helmet sets no cache headers, and the static handler's `no-cache` does not
 * reach `/api`.
 */
const noStore = (reply: FastifyReply) => reply.header('cache-control', 'no-store')

export const registerAuthRoutes = (app: FastifyInstance, { db, config, sessions }: AuthRouteDeps) => {
  app.post('/api/auth/login', async (request, reply) => {
    const parsed = loginRequestSchema.safeParse(request.body)
    void noStore(reply)

    if (!parsed.success) {
      // Deliberately not `bad_request`: a malformed body and a wrong password
      // must be indistinguishable, or the shape of the error tells an attacker
      // whether an address parses as an account.
      return reply.code(401).send(errorResponse('invalid_credentials'))
    }

    const [row] = await db
      .select({ id: account.id, password_hash: account.password_hash })
      .from(account)
      .where(eq(account.email, parsed.data.email))
      .limit(1)

    // Deliberately no early return when `row` is undefined: `verifyPassword`
    // spends the same work on a null hash as on a real one, so an unknown
    // address and a wrong password take the same time. That property lives
    // there, with the measurement that motivated it — this line only has to
    // avoid short-circuiting past it.
    const stored = row?.password_hash ?? null
    const ok = await verifyPassword(parsed.data.password, stored)

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

    void reply.header('set-cookie', cookieHeader(sessions.issue(row.id), config, config.session_ttl_seconds))

    const viewer: Viewer = { account_id: row.id, roles: await rolesFor(db, row.id) }
    return reply.code(200).send({ viewer } satisfies MeResponse)
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
