import type { ErrorCode, ErrorResponse } from '@sage-burner/shared'
import type { FastifyError, FastifyInstance } from 'fastify'

import { errorResponse } from '@sage-burner/shared'

/**
 * Map anything thrown into the documented error envelope.
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
/**
 * Headers an error asked to be sent with it.
 *
 * `FastifyError` does not declare `headers`, but Fastify's own default handler
 * reads it — so this narrows rather than casting, and keeps only string values,
 * which is what `reply.headers` can carry.
 */
const headersFrom = (error: unknown): Record<string, string> | undefined => {
  if (typeof error !== 'object' || error === null || !('headers' in error)) return undefined

  const { headers } = error
  if (typeof headers !== 'object' || headers === null) return undefined

  const usable: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string') usable[name] = value
  }

  return Object.keys(usable).length > 0 ? usable : undefined
}

const codeFor = (status: number): ErrorCode => {
  if (status === 404) return 'not_found'
  if (status >= 400 && status < 500) return 'bad_request'
  return 'internal_error'
}

export const registerErrorHandler = (app: FastifyInstance) => {
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    // Clamped, not taken verbatim. An error carrying a 2xx statusCode would
    // otherwise answer `200 {"error":"internal_error"}` — the one shape the
    // envelope must never take, because the web client checks `response.ok`
    // and would hand that object back to the caller as the payload rather
    // than throwing. Falls back to a status the route already set on the
    // reply, which Fastify's default handler preserves and this would
    // otherwise discard.
    const fromReply = reply.statusCode >= 400 ? reply.statusCode : undefined
    const chosen = error.statusCode ?? fromReply
    const status = chosen !== undefined && chosen >= 400 && chosen <= 599 ? chosen : 500

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
