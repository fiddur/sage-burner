import type { FastifyReply } from 'fastify'

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
 *
 * Lives here rather than in `routes/auth.ts`, where it started, because the
 * question it answers is not an auth question: the admin roster carries every
 * account's email address and wants the same treatment for the same reason.
 * Still per-route rather than an `onSend` hook over `/api` — with two callers
 * a hook is more machinery than rule, and a public response marked `no-store`
 * would be a quieter mistake than a private one left cacheable.
 */
export const noStore = (reply: FastifyReply) => reply.header('cache-control', 'no-store')
