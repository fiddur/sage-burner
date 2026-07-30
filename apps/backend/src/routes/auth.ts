import type { MeResponse, Viewer } from '@sage-burner/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { errorResponse, loginRequestSchema } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'

import type { Sessions } from '../auth/session.ts'
import type { Config } from '../config.ts'
import type { Database } from '../db/index.ts'

import { createGate } from '../auth/gate.ts'
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
 * - `Secure` whenever `config.secure_cookies` — production, *or* bound beyond
 *   loopback. The image is both, so every containerised deployment gets it; the
 *   environment without it is `pnpm dev` on loopback.
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
const cookieHeader = (token: string, config: Config, maxAgeSeconds: number): string => {
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

/**
 * Read the session cookie without a cookie-parsing dependency.
 *
 * One header, one name, and the token alphabet is base64url plus a dot — so
 * `decodeURIComponent` is not needed and a full parser buys nothing.
 *
 * Duplicates are possible: RFC 6265 orders cookies by descending path
 * specificity, so one injected with `Path=/api` arrives ahead of the real
 * `Path=/` one. That needs an attacker who can already set cookies for the
 * domain — a sibling-subdomain XSS, or a plain-HTTP MITM before HSTS is
 * pinned.
 *
 * They cannot *forge* a token; the signature still has to check out. But they
 * do not need to: they can log in as themselves and plant **their own valid**
 * token. That is session fixation, and the damage is not a sign-out. The
 * victim's browser fetches `/api/auth/me`, gets the attacker's account, renders
 * a signed-in nav — and whatever the member then edits into their profile,
 * contact details and allergies included, is written to a record the attacker
 * can read back at leisure.
 *
 * So this refuses outright when the header carries more than one. A legitimate
 * client never sends two — the cookie is always `Path=/` with no `Domain`, so
 * there is only ever one to send — which makes a second one, by definition,
 * planted.
 *
 * Be precise about what that costs, because it is not a nuisance. Logging in
 * again does **not** clear it: the login sets `Path=/`, and a cookie with a
 * different path is a different cookie, so the planted one survives alongside
 * it. Every subsequent request then carries two and is refused. The member is
 * locked out until the planted cookie expires or they clear cookies by hand —
 * and the SPA shows them signed in from the login response, then signed out on
 * the next load, which is the confusing failure the `Secure` note above warns
 * about.
 *
 * Still the right trade. A durable lockout beats a member typing their
 * allergies and contact details into an attacker's record. But #58's `__Host-`
 * prefix is what *ends* this, not merely a tidier spelling of it.
 *
 * `__Host-` remains the real fix, and it is more tractable than it was: `Secure`
 * is now one decision, `config.secure_cookies`, so the prefix can key off the
 * same predicate as the flag rather than needing a rule of its own. What still
 * blocks a straight rename is that the name must vary at all — `pnpm dev` on
 * loopback gets no `Secure`, and a `__Host-` cookie without it is rejected
 * outright. Tracked in #58. This does not wait for it.
 */
export const readSessionCookie = (header: string | undefined): string | undefined => {
  if (header === undefined) return undefined

  const present = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${SESSION_COOKIE}=`))

  // Counted, not first-wins. Duplicates are refused whether or not the extra
  // one has a value: an empty planted cookie cannot fixate a session, but
  // distinguishing the cases buys nothing and costs a branch to get wrong.
  if (present.length !== 1) return undefined

  const value = present[0]?.slice(SESSION_COOKIE.length + 1)
  return value === undefined || value === '' ? undefined : value
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

/**
 * Bounds on concurrent password verification.
 *
 * `scrypt` costs ~230ms and 64 MiB and runs on libuv's threadpool — four slots
 * by default, shared with the file reads `@fastify/static` does. Two leaves
 * half the pool for everything else.
 *
 * Queued rather than shed, which matters more than the numbers. A hard cap
 * means two sustained anonymous requests refuse every member's login for as
 * long as they are held, with nothing to wait out — a permanent outage of the
 * only way into the app, triggerable from a laptop. A FIFO queue keeps the same
 * threadpool bound while letting a member arriving mid-flood take their turn.
 *
 * The queue is bounded so it cannot become the exhaustion it prevents, and the
 * wait is bounded so a caller is answered rather than held open.
 *
 * The timeout is sized for the expensive case rather than the usual one. A
 * successful login can spend *two* hashes, not one — `verifyPassword` and then
 * `hashPassword` for the opportunistic upgrade — and both are inside the slot,
 * because the release is in the route's `finally`. That is precisely the state
 * a parameter raise puts every account into, so the worst case coincides with
 * the one time the queue is likely to be at full depth.
 *
 * Measured, not estimated: a login verifying against the previous OWASP rung
 * and re-hashing to the current one takes ~389ms, against ~223ms in the steady
 * state. Eight deep at two at a time is four turns, so ~1556ms — which a 2s
 * timeout clears by 22%, and a container slower than this machine does not. At
 * 5s the margin is ~3x. The cost of the longer wait is a held connection, which
 * is cheaper than refusing someone who typed the right password.
 *
 * Still not a rate limiter: this bounds concurrent work, not attempts per
 * caller. #57 is that, and it is what bounds guessing.
 */
const LOGIN_GATE = { slots: 2, queue: 8, timeoutMs: 5000 }

export const registerAuthRoutes = (app: FastifyInstance, { db, config, sessions }: AuthRouteDeps) => {
  // Per-registration rather than module-level, so two apps in one test process
  // do not share a gate.
  const gate = createGate(LOGIN_GATE)
  const handleLogin = async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = loginRequestSchema.safeParse(request.body)

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

    void reply.header('set-cookie', cookieHeader(sessions.issue(row.id), config, config.session_ttl_seconds))

    const viewer: Viewer = { account_id: row.id, roles: await rolesFor(db, row.id) }
    return reply.code(200).send({ viewer } satisfies MeResponse)
  }

  app.post('/api/auth/login', async (request, reply) => {
    void noStore(reply)

    // Taken before any work, so the bound cannot depend on what the database
    // driver does between a check and a claim.
    const admission = await gate.enter()

    if (!admission.ok) {
      // The advice differs by reason, and so does what already happened.
      // `queue-full` is refused synchronously and waited for nothing, and the
      // work in flight clears shortly, so a second is about right. `timed-out`
      // held on for the whole window against a gate that stayed saturated —
      // sending that caller straight back turns a client politely honouring
      // `Retry-After` into a hot retry loop, adding churn under exactly the
      // flood this exists to damp.
      void reply.header('retry-after', admission.reason === 'timed-out' ? '5' : '1')
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
