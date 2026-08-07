import type { FastifyReply, FastifyRequest } from 'fastify'
import type { z, ZodType } from 'zod'

import { errorResponse } from '@sage-burner/shared'

import { codeFor } from './errors.ts'

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

/**
 * The statuses a route here answers a caller with.
 *
 * A closed set rather than `number`, so `sendError(reply, 419)` does not compile.
 * `415` is the avatar and icon uploads refusing a content type; everything else is
 * the ordinary four.
 */
export type ClientStatus = 400 | 401 | 403 | 404 | 409 | 415 | 429

/**
 * Refuse a request, with the slug that goes with the status (#138).
 *
 * This was written out at 35 call sites as `reply.code(404).send(errorResponse(
 * 'not_found'))` — the status and its slug named separately, every time, with
 * nothing tying them together. `codeFor` already owned the mapping for the error
 * handler; nothing made the routes go through it, so `reply.code(404).send(
 * errorResponse('conflict'))` compiled and would have answered exactly that.
 *
 * Now the slug is not spelled at the call site at all, which is what makes the
 * wrong pairing unrepresentable rather than merely unlikely.
 *
 * **Not every refusal goes through here**, and the exceptions are the point rather
 * than leftovers. Both logins — password and passkey — answer 401 with
 * `invalid_credentials`, which is deliberately distinguishable from a missing
 * session and is a fact about the route rather than about the status.
 * `sessions.ts` and `profile.ts` carry a status and slug together out of a
 * discriminated union. Those keep `errorResponse` explicitly, which reads as "this
 * one is different" precisely because everything else no longer does.
 */
export const sendError = (reply: FastifyReply, status: ClientStatus) =>
  reply.code(status).send(errorResponse(codeFor(status)))

/**
 * The body, parsed, or nothing.
 *
 * The other half of the same opening: `safeParse` then `if (!parsed.success)` began
 * ~24 handlers, and the `parsed.` indirection was carried through the rest of each
 * one for no reason — every route wanted `parsed.data` and none of them looked at
 * `parsed.error`.
 *
 * Inference only, no cast: the return type is the schema's own output, so a handler
 * that reads a field the schema does not describe is still a type error.
 */
export const bodyOf = <Schema extends ZodType>(
  schema: Schema,
  // Only the body is touched, so only the body is asked for. That also lets a test
  // hand over a plain object rather than casting one into a `FastifyRequest`.
  request: Pick<FastifyRequest, 'body'>,
): z.infer<Schema> | undefined => {
  const parsed = schema.safeParse(request.body)

  return parsed.success ? parsed.data : undefined
}
