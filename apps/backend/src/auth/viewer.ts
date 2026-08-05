import type { Viewer } from '@sage-burner/shared'
import type { FastifyRequest } from 'fastify'

import { eq } from 'drizzle-orm'

import type { Database } from '../db/index.ts'
import type { Sessions } from './session.ts'

/**
 * All of a request this needs — the cookie header, and an identity to key on.
 *
 * Narrower than `FastifyRequest` so a test can hand it a plain object rather than
 * casting one into shape. `FastifyRequest` satisfies it, so every call site is
 * unchanged.
 */
type Requesting = Pick<FastifyRequest, 'headers'>

import { account, accountRole } from '../db/schema.ts'

/**
 * Who is signed in, and the cookie that says so.
 *
 * Here rather than in `routes/auth.ts`, where it began. The guards need exactly
 * this, so a guard was importing from a route file — an inversion that made
 * `auth/` depend on the thing it exists to protect (#139).
 */

export const SESSION_COOKIE = 'sage_session'

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
 * Be precise about what this buys, because it is half of the threat above, not
 * all of it. The refusal only fires when *two* cookies arrive, which needs the
 * victim to already hold one. A victim who is **signed out** holds none, so a
 * single planted `sage_session=<attacker token>; Domain=example.org` is the only
 * cookie present, `present.length === 1`, and it is accepted — `/api/auth/me`
 * answers with the attacker's account and the member fills in their details
 * there. So: a victim who already holds a session cannot be swapped onto another
 * account. A signed-out one still can.
 *
 * That is why #58 is the fix rather than a tidier spelling of this. `__Host-`
 * forbids `Domain`, so a sibling subdomain's cookie is host-only to that
 * subdomain and never reaches this origin at all — which the duplicate check
 * cannot reach by construction.
 *
 * And be precise about the cost, because it is not a nuisance and it is paid in
 * both cases. Logging in again does **not** clear a planted cookie: the login sets `Path=/`, and a cookie with a
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

/**
 * Whose viewer a request has already resolved, so it is resolved once.
 *
 * A guard answers 401/403 from the viewer and then throws it away, and the handler
 * behind it asks again — two identical joins per authenticated request, on every
 * one of them (#139). This holds the first answer.
 *
 * Keyed on the request object rather than decorating it, so there is no Fastify
 * type augmentation to keep in step and nothing on the request for a serialiser to
 * find. A `WeakMap` because the entry must go when the request does; a plain `Map`
 * here would be a leak that grows for the life of the process.
 *
 * Module-level, which the code style otherwise forbids — but this is a cache keyed
 * on identity, not state: two apps in one process cannot collide, because they
 * cannot see the same request object. Nothing observable depends on what is in it,
 * only on how many queries were spent getting there.
 */
const resolved = new WeakMap<Requesting, Viewer | undefined>()

/**
 * The signed-in account, or undefined.
 *
 * Exported because the guards need exactly this and must not each re-derive it.
 * Returns undefined for a valid token whose account has since been deleted — the
 * signature proves the token was ours, not that the row still exists.
 *
 * Answers from `resolved` when this request has asked before, so the guard and the
 * handler behind it share one query. A miss and a cached `undefined` are told apart
 * with `has`, or an anonymous request would re-derive on every call.
 */
export const viewerFor = async (
  request: Requesting,
  deps: { db: Database; sessions: Sessions },
): Promise<Viewer | undefined> => {
  if (resolved.has(request)) return resolved.get(request)

  const viewer = await readViewer(request, deps)
  resolved.set(request, viewer)

  return viewer
}

const readViewer = async (
  request: Requesting,
  deps: { db: Database; sessions: Sessions },
): Promise<Viewer | undefined> => {
  const token = readSessionCookie(request.headers.cookie)
  if (token === undefined) return undefined

  const payload = deps.sessions.read(token)
  if (payload === undefined) return undefined

  // One query, not two. A left join rather than an existence check followed by
  // `rolesFor`: this runs on every guarded request, so the second round trip was
  // pure overhead. Left, not inner — an account with no roles must still resolve
  // to a viewer, since "signed in with no role" is an ordinary state (an
  // applicant checking on their application).
  const rows = await deps.db
    .select({ id: account.id, name: account.name, role: accountRole.role })
    .from(account)
    .leftJoin(accountRole, eq(accountRole.account_id, account.id))
    .where(eq(account.id, payload.account_id))

  const first = rows[0]
  if (first === undefined) return undefined

  // `role` is null on the no-roles row the left join produces, and only there.
  return {
    account_id: first.id,
    name: first.name,
    roles: rows.map((row) => row.role).filter((role) => role !== null),
  }
}
