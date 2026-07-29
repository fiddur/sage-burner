import type { ErrorCode, ErrorResponse } from '@sage-burner/shared'
import type { FastifyError, FastifyInstance } from 'fastify'

import { errorResponse } from '@sage-burner/shared'

/**
 * Mapping anything thrown into the documented error envelope.
 *
 * Without this, Fastify's built-in serializer answers with
 * `{ statusCode, error: 'Internal Server Error', message }` — which satisfies
 * `errorResponseSchema`, since `error` is a string, while putting a *sentence*
 * where the envelope promises a machine-readable slug. A client branching on
 * `code` would be branching on prose, and the message can carry internals: a
 * SQL fragment, a file path, a column name.
 *
 * So the response carries the code and nothing else, and the real error goes to
 * the log where it is useful and not public.
 */

/** Header values Node's `setHeader` accepts, which is what `reply.headers` forwards to. */
type HeaderValue = number | string | string[]

/**
 * Headers an error asked to be sent with it.
 *
 * `FastifyError` does not declare `headers`, but Fastify's own default handler
 * passes it to `reply.headers` untouched — so this narrows rather than casting,
 * and accepts everything that call can carry. Filtering to strings would drop
 * the numeric `Retry-After` a rate limiter emits, silently, which is precisely
 * one of the cases this function exists for.
 */
const headersFrom = (error: unknown): Record<string, HeaderValue> | undefined => {
  if (typeof error !== 'object' || error === null || !('headers' in error)) return undefined

  const { headers } = error
  if (typeof headers !== 'object' || headers === null) return undefined

  const usable: Record<string, HeaderValue> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string' || typeof value === 'number') {
      usable[name] = value
    } else if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
      usable[name] = value
    }
  }

  return Object.keys(usable).length > 0 ? usable : undefined
}

/**
 * The status an error asked for, if it asked for a usable one.
 *
 * Either field is honoured only when it is already an error status. Some
 * middleware sets `status` alone; reading `statusCode` by itself would answer
 * 500 to an error that plainly said 403, and log it as ours rather than the
 * caller's. A declared 2xx is ignored rather than sent, because the envelope
 * with an ok status is the one shape it must never take — the web client
 * checks `response.ok` and would hand `{ error: … }` back as the payload.
 *
 * `status` wins over `statusCode`, which is one ordering where Fastify has
 * two. `setErrorHeaders` reads `status` first; `setErrorStatusCode`, which
 * runs immediately after it, reads `statusCode` first — and because the first
 * writes `res.statusCode` directly rather than through `reply.code()`,
 * `kReplyHasStatusCode` stays false and the second overwrites it. So the
 * effective default is `status`-first when the route set a status of its own
 * and `statusCode`-first when it did not. This picks `status` first
 * throughout: it matches the default in the case that has a route behind it,
 * and the divergence needs an error carrying both fields, both >= 400 and
 * different, which nothing in the tree emits.
 *
 * Deliberately stricter than the default in one respect: Fastify compares
 * loosely, so `status: '403'` passes `>= 400` there and becomes a 500 here.
 * A status is a number.
 */
const declaredStatus = (error: unknown): number | undefined => {
  if (typeof error !== 'object' || error === null) return undefined

  // Spelled out rather than looped over: `in` narrows on a literal key, not on
  // a union of them, and a loop would need a cast to read the field back.
  const usable = (value: unknown) => (typeof value === 'number' && value >= 400 ? value : undefined)
  const fromStatus = 'status' in error ? usable(error.status) : undefined

  return fromStatus ?? ('statusCode' in error ? usable(error.statusCode) : undefined)
}

const codeFor = (status: number): ErrorCode => {
  if (status === 404) return 'not_found'
  if (status >= 400 && status < 500) return 'bad_request'
  return 'internal_error'
}

export const registerErrorHandler = (app: FastifyInstance) => {
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    // Falls back to a status the route already set on the reply, which
    // Fastify's default handler preserves and this would otherwise discard.
    //
    // The upper clamp guards this handler, not Node: `reply.code()` rejects
    // anything outside 100–599 with FST_ERR_BAD_STATUS_CODE, and `handleError`
    // wraps the call to this function in a try/catch whose `catch` does
    // `reply.send(err)`. So an unclamped 600 would throw here and be re-sent
    // through the root handler as Fastify's `{ statusCode, error, message }`
    // prose — the exact envelope this file exists to keep off the wire, leaking
    // on the one path least likely to be exercised.
    const fromReply = reply.statusCode >= 400 ? reply.statusCode : undefined
    const chosen = declaredStatus(error) ?? fromReply ?? 500
    const status = chosen <= 599 ? chosen : 500

    // 5xx is ours to explain; 4xx is the caller's mistake and would otherwise
    // fill the log with noise anyone can generate.
    if (status >= 500) {
      request.log.error({ err: error }, 'request failed')
    } else {
      request.log.info({ err: error, status }, 'request rejected')
    }

    // Fastify's default handler copies these across; replacing it drops them
    // silently. The two plausible sources are both on the roadmap — a 401
    // `WWW-Authenticate` challenge with #8, and `Retry-After` from the invite
    // rate limiter — and a missing challenge header looks like a client bug.
    const headers = headersFrom(error)
    if (headers !== undefined) void reply.headers(headers)

    const body: ErrorResponse = errorResponse(codeFor(status))
    return reply.code(status).send(body)
  })
}
